# AI agent instructions

Instructions for AI coding agents (Claude Code, etc.) working in this repository.
Humans: this doubles as a maintainer quick-reference. Keep it accurate when you
change the build, release flow, or invariants.

## What this is

`openclaw-plugin-onepassword` — a native [OpenClaw](https://openclaw.ai) plugin
that resolves 1Password secrets **in-process** (inside the Gateway, bypassing
OpenClaw's exec secret sandbox) into the shared secret store, and exposes
optional 1Password vault/item agent tools. See [README.md](./README.md) for the
architecture and user-facing docs.

## Project layout

| Path                       | Purpose                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Plugin entry (`definePluginEntry`): registers the sync service, gateway methods, and tools. |
| `src/config.ts`            | Config parsing/validation.                                                                  |
| `src/op-client.ts`         | Thin wrapper over `@1password/sdk` (the `OnePasswordClient` interface).                     |
| `src/secret-sync.ts`       | Resolve `op://` refs and write them to the store.                                           |
| `src/file-sync.ts`         | Resolve `op://` refs and write them to a JSON file (atomic, `0600`).                        |
| `src/tools.ts`             | Optional agent tools.                                                                       |
| `src/resolver.ts`          | Optional standalone exec resolver (advanced mode).                                          |
| `src/version.ts`           | `PLUGIN_VERSION` / `PLUGIN_ID` constants.                                                   |
| `openclaw.plugin.json`     | Plugin manifest (tools, gateway methods, config schema, exec integration).                  |
| `test/`                    | Vitest unit tests (no network — mock `OnePasswordClient`).                                  |
| `scripts/bump-version.mjs` | The only supported way to change the version.                                               |

## Setup & commands

```bash
npm install --ignore-scripts   # REQUIRED: openclaw's preinstall gate fails otherwise
npm run verify                 # typecheck + lint + format:check + test + build
```

Individual: `npm run build`, `npm run typecheck`, `npm run lint`,
`npm run format` (write) / `npm run format:check`, `npm test`.

> Always use `--ignore-scripts` for installs here. The `openclaw` dev dependency
> runs a Node-version preinstall check that aborts `npm install`; we only need
> its type definitions.

## Invariants — do not break these

1. **No hardcoded 1Password specifics.** Never hardcode vault names, item paths,
   or field names in code. They come from user config / `SecretRef` ids only.
2. **Never log or print secret values.** Redact concealed fields; route errors so
   credential material can't reach stdout/logs. The exec resolver must only emit
   the JSON protocol on stdout.
3. **Version stays in sync across three files** — `package.json`,
   `openclaw.plugin.json`, and `src/version.ts`. A unit test enforces equality.
   Change them only via the bump script (below).
4. **Tests must not hit the network.** Mock `OnePasswordClient`.
5. `npm run verify` must pass before any commit to `main`.
6. Keep the CHANGELOG's `[Unreleased]` section updated as you make user-facing
   changes.

## Making changes

1. Implement the change in `src/`, matching existing style (Prettier + ESLint).
2. Add/adjust tests in `test/`.
3. Add a bullet under `## [Unreleased]` in `CHANGELOG.md` if user-facing.
4. `npm run verify`.
5. Commit. Conventional Commits preferred (`feat:`, `fix:`, `docs:`, `chore:`).

## Versioning & releases

Releases are **automated on push to `main`**: the `Release` workflow publishes to
npm (with provenance) and creates a GitHub release **only when `package.json`'s
version is not yet on npm**. Ordinary commits don't publish. There are no manual
`npm publish` steps and no separate release branch.

**To cut a release:**

1. Pick the [semver](https://semver.org) bump:
   - **patch** (`0.1.0 → 0.1.1`): backwards-compatible bug fixes, docs, internals.
   - **minor** (`0.1.0 → 0.2.0`): backwards-compatible new features/config/tools.
   - **major** (`0.1.0 → 1.0.0`): breaking changes to config, `SecretRef` usage,
     tool contracts, or the minimum OpenClaw version.
   - Pre-1.0 note: this project is `0.x`; treat breaking changes as a **minor**
     bump while under `1.0.0`, and reserve major for the eventual `1.0.0`.
2. Run the bump (updates all three version files + rolls the changelog):
   ```bash
   npm run release:prepare -- <x.y.z>
   ```
3. Edit `CHANGELOG.md` so the new `[x.y.z]` section accurately describes the
   changes (move/curate items from `[Unreleased]`).
4. `npm run verify`.
5. Commit and push to `main`:
   ```bash
   git commit -am "chore(release): v<x.y.z>"
   git push origin main
   ```
6. The workflow does the rest (publish + tag `v<x.y.z>` + GitHub release). Do
   **not** create the tag yourself — the workflow creates it.

**Never** hand-edit version numbers or run `npm publish` locally. If a release
fails, fix forward with a new patch version rather than re-publishing an existing
one (npm forbids overwriting a published version).

## Compatibility notes

- Runtime target: the OpenClaw Gateway (Node ≥ 22.22.3). CI also builds/tests on
  Node 20.
- Peer dependency: `openclaw >= 2026.8.0`. If you rely on a newer OpenClaw SDK
  API, bump the peer range and `openclaw.compat` in `package.json`, and note it
  in the changelog as at least a minor change.
- The plugin ships compiled `dist/` (ESM). `openclaw.extensions` points at
  `./dist/index.js`; the exec integration points at `./dist/resolver.js`.
