# openclaw-plugin-onepassword

[![CI](https://github.com/ioleksiy/openclaw-plugin-onepassword/actions/workflows/ci.yml/badge.svg)](https://github.com/ioleksiy/openclaw-plugin-onepassword/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/openclaw-plugin-onepassword.svg)](https://www.npmjs.com/package/openclaw-plugin-onepassword)
[![license](https://img.shields.io/npm/l/openclaw-plugin-onepassword.svg)](./LICENSE)

A native [OpenClaw](https://openclaw.ai) plugin that resolves **[1Password](https://1password.com) secrets in-process** inside the Gateway — no `op` CLI, no child process, no exec sandbox — and writes them into OpenClaw's shared secret store. It also exposes optional 1Password vault/item **agent tools**.

> **Why this exists.** OpenClaw **v2026.8.1** introduced a security sandbox for `exec` secret providers that blocks **filesystem writes and network access** during provider execution. That breaks the common pattern of using `op read` as an exec provider (you'll see errors like `sh: cannot open /tmp/op_out.txt` and blocked network calls). This plugin runs **inside the Gateway process**, where the sandbox does not apply, and uses the official [`@1password/sdk`](https://github.com/1Password/onepassword-sdk-js) over HTTPS.

---

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start (store sync — recommended)](#quick-start-store-sync--recommended)
- [Configuration reference](#configuration-reference)
- [Agent tools (optional)](#agent-tools-optional)
- [Gateway methods](#gateway-methods)
- [Refreshing secrets at runtime](#refreshing-secrets-at-runtime)
- [Exec resolver mode (advanced)](#exec-resolver-mode-advanced)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Publishing](#publishing)
- [License](#license)

---

## How it works

There are two ways a plugin can feed secrets to OpenClaw. This plugin ships both, but **the in-process store sync is the recommended path** because it is the only one that reliably bypasses the exec sandbox.

| Mode                         | Runs where             | Bypasses exec sandbox?           | `SecretRef` you write                  | Vault/item paths live in      |
| ---------------------------- | ---------------------- | -------------------------------- | -------------------------------------- | ----------------------------- |
| **Store sync** (default)     | In-process (Gateway)   | ✅ Yes                           | `source: "store"`                      | plugin `config.secrets` map   |
| **Exec resolver** (advanced) | Sandboxed child `node` | ⚠️ Only with egress allowlisting | `source: "exec"` + `pluginIntegration` | the `SecretRef.id` (`op://…`) |

**Store sync**, in one picture:

```
Gateway start / onepassword.sync
        │
        ▼
 read OP_SERVICE_ACCOUNT_TOKEN (env)
        │
        ▼
 @1password/sdk  ──HTTPS──▶  1Password API
        │
        ▼
 secrets.store.set { name, value }   (in-process Gateway RPC)
        │
        ▼
 OpenClaw shared store  ◀── resolved by SecretRefs with source:"store"
```

The plugin never writes secrets to `openclaw.json`, environment variables, or disk of its own. Values live only in OpenClaw's store (SQLite, `0600`/`0700` permissions, team scope).

## Requirements

- **OpenClaw** `>= 2026.8.0` (Gateway runs on Node `>= 22.22.3`).
- A **1Password service account** token — see [1Password service accounts](https://developer.1password.com/docs/service-accounts). The service account must have access to the vaults/items you reference.

## Install

From npm (recommended):

```bash
openclaw plugins install openclaw-plugin-onepassword
```

Or from a local checkout:

```bash
openclaw plugins install ./openclaw-plugin-onepassword
```

Then provide the service account token to the **Gateway process** via the environment variable (default `OP_SERVICE_ACCOUNT_TOKEN`). Keep it out of `openclaw.json`, docker-compose files, and shell history — use your process manager's secret mechanism (systemd `LoadCredential`, Docker/Kubernetes secrets, etc.).

```bash
export OP_SERVICE_ACCOUNT_TOKEN="ops_..."
```

## Quick start (store sync — recommended)

1. **Enable the plugin and map store keys to 1Password references** in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "onepassword": {
        "enabled": true,
        "config": {
          "serviceAccountTokenEnvVar": "OP_SERVICE_ACCOUNT_TOKEN",
          "secrets": {
            "SLACK_BOT_TOKEN": "op://MyVault/SlackBot/bot_token",
            "SLACK_APP_TOKEN": "op://MyVault/SlackBot/app_token",
            "OPENAI_API_KEY": "op://MyVault/OpenAI/credential"
          }
        }
      }
    }
  }
}
```

Store keys must match `^[A-Z][A-Z0-9_]{0,127}$` (OpenClaw store-id grammar). Values are standard [1Password secret references](https://developer.1password.com/docs/cli/secret-references/): `op://Vault/Item[/Section]/Field`.

2. **Reference those store keys** anywhere OpenClaw accepts a `SecretRef`, using `source: "store"`:

```json
{
  "channels": {
    "slack": {
      "accounts": {
        "myworkspace": {
          "botToken": { "source": "store", "id": "SLACK_BOT_TOKEN" },
          "appToken": { "source": "store", "id": "SLACK_APP_TOKEN" }
        }
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "providers": {
          "openai": {
            "apiKey": { "source": "store", "id": "OPENAI_API_KEY" }
          }
        }
      }
    }
  }
}
```

3. **Start the Gateway.** On startup the plugin fetches each reference from 1Password and writes it into the store; the referencing channels/providers then initialize with resolved credentials. Because store values persist, subsequent restarts are covered even before the first sync completes.

See [`examples/`](./examples) for complete config files.

## Configuration reference

All keys live under `plugins.entries.onepassword.config`.

| Key                         | Type    | Default                         | Description                                                                                                                   |
| --------------------------- | ------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `serviceAccountTokenEnvVar` | string  | `"OP_SERVICE_ACCOUNT_TOKEN"`    | Name of the environment variable holding the service account token.                                                           |
| `secrets`                   | object  | `{}`                            | Map of **store key → `op://…` reference**. Store keys must match `^[A-Z][A-Z0-9_]{0,127}$`.                                   |
| `syncOnStartup`             | boolean | `true`                          | Fetch `secrets` from 1Password and write to the store at Gateway startup.                                                     |
| `failFastOnStartup`         | boolean | `false`                         | If `true`, a startup sync failure throws and prevents startup. If `false`, log and fall back to last-known-good store values. |
| `integrationName`           | string  | `"openclaw-plugin-onepassword"` | Integration name reported to 1Password audit logs.                                                                            |
| `requestTimeoutMs`          | number  | `15000`                         | Per-operation timeout for 1Password SDK calls.                                                                                |
| `tools.enabled`             | boolean | `false`                         | Register the read-only 1Password agent tools.                                                                                 |
| `tools.allowWrite`          | boolean | `false`                         | Also register create/update/delete tools. Requires `tools.enabled`.                                                           |

The plugin **hardcodes no vault names, item paths, or field names**. The only 1Password-specific configuration is the env var name and the `secrets` map you provide.

## Agent tools (optional)

Set `tools.enabled: true` to expose in-process tools to the agent. Read tools redact concealed field values by default.

| Tool                    | Requires `allowWrite` | Description                                                                |
| ----------------------- | --------------------- | -------------------------------------------------------------------------- |
| `1password_list_vaults` |                       | List vaults accessible to the service account.                             |
| `1password_list_items`  |                       | List item overviews in a vault.                                            |
| `1password_get_item`    |                       | Get a full item (concealed fields redacted unless `includeSecrets: true`). |
| `1password_read_field`  |                       | Resolve a single `op://…` reference to its value.                          |
| `1password_create_item` | ✅                    | Create a new item.                                                         |
| `1password_update_item` | ✅                    | Update an existing item.                                                   |
| `1password_delete_item` | ✅                    | Delete an item.                                                            |

```json
{
  "plugins": {
    "entries": {
      "onepassword": {
        "enabled": true,
        "config": { "tools": { "enabled": true, "allowWrite": false } }
      }
    }
  }
}
```

## Gateway methods

Both require the `operator.admin` scope.

- **`onepassword.sync`** — re-fetch every configured secret from 1Password and write it into the store. Returns `{ written, total, resolveErrors, storeErrors }`.
- **`onepassword.status`** — non-secret health/config summary: `{ version, serviceAccountTokenEnvVar, tokenPresent, syncOnStartup, managedStoreKeys, toolsEnabled, toolsWriteEnabled }`.

## Refreshing secrets at runtime

- **Rotate a value in 1Password**, then call **`onepassword.sync`** (or restart the Gateway). The plugin re-fetches and writes fresh values; `secrets.store.set` triggers a live runtime refresh so dependent channels/providers pick up the new value without a full restart.
- `openclaw secrets reload` re-reads the **store**; run `onepassword.sync` first if you need the store repopulated from 1Password.

> Prefer native `openclaw secrets reload` to re-fetch directly from 1Password? Use the [exec resolver mode](#exec-resolver-mode-advanced), which OpenClaw re-invokes on reload — at the cost of requiring egress allowlisting.

## Exec resolver mode (advanced)

The plugin also declares a `secretProviderIntegrations` entry so it can act as a plugin-managed **exec** secret provider using standard `op://` ids:

```json
{
  "secrets": {
    "providers": {
      "op": {
        "source": "exec",
        "pluginIntegration": { "pluginId": "onepassword", "integrationId": "op" }
      }
    }
  },
  "channels": {
    "slack": {
      "accounts": {
        "myworkspace": {
          "botToken": {
            "source": "exec",
            "provider": "op",
            "id": "op://MyVault/SlackBot/bot_token"
          }
        }
      }
    }
  }
}
```

**Caveat:** this runs OpenClaw's resolver as a **sandboxed child `node` process** (`command: "${node}"`). Under the v2026.8.1 sandbox its network is blocked, so it can only reach the 1Password API if you allowlist egress for secret resolution:

```json
{
  "secrets": {
    "egressProxy": {
      "enabled": true,
      "allowedHosts": ["my.1password.com", "my.1password.eu", "my.1password.ca"]
    }
  }
}
```

Use the host that matches your 1Password account region. If your environment cannot allow this egress, use the [store sync](#quick-start-store-sync--recommended) mode instead. The exec resolver reads the token from `OP_SERVICE_ACCOUNT_TOKEN` (override the env var name with `OP_RESOLVER_TOKEN_ENV_VAR`).

## Security notes

- **The token is the crown jewel.** Anyone with the service account token has the service account's access. Scope the service account to the minimum vaults required, and inject the token via your platform's secret mechanism — never commit it.
- **No plaintext secrets in config.** The plugin only reads an env var name and `op://` references; resolved values live only in OpenClaw's store.
- **Plugin code runs in your Gateway process** with full Gateway privileges (this is true of every OpenClaw plugin). Review the source before installing.
- **Write tools are opt-in** (`tools.allowWrite`) and **concealed fields are redacted** by read tools unless `includeSecrets: true`.
- Report vulnerabilities per [SECURITY.md](./SECURITY.md).

## Troubleshooting

| Symptom                                     | Likely cause / fix                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `... token not found` at startup            | The env var named by `serviceAccountTokenEnvVar` is unset on the Gateway process.                                     |
| `SECRETS_PROVIDER_DEGRADED` for a store ref | The store key hasn't been populated yet — run `onepassword.sync`, or check the startup logs for resolve errors.       |
| Resolve error `NOT_FOUND`                   | The `op://` reference is wrong or the service account can't access that vault/item/field.                             |
| Exec resolver returns nothing               | Sandbox is blocking network — add your 1Password host to `secrets.egressProxy.allowedHosts`, or switch to store sync. |

## Development

```bash
npm install --ignore-scripts   # openclaw's preinstall gate is skipped here
npm run build                  # tsc -> dist/
npm run typecheck
npm run lint
npm test
```

> `--ignore-scripts` is used because the `openclaw` dev dependency runs a Node-version preinstall check; the plugin itself only needs its type definitions to build and test.

## Publishing

See [CONTRIBUTING.md → Releasing](./CONTRIBUTING.md#releasing). In short: bump the version in `package.json`, `openclaw.plugin.json`, and `src/version.ts` (kept in sync by a test), update `CHANGELOG.md`, tag `vX.Y.Z`, and let the release workflow publish to npm with provenance.

## License

[MIT](./LICENSE)
