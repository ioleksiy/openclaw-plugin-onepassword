/**
 * openclaw-plugin-onepassword
 *
 * Native OpenClaw plugin that resolves 1Password secrets *in-process* (inside
 * the Gateway, not as a sandboxed child) and writes them into OpenClaw's shared
 * secret store, plus optional agent tools for vault/item operations.
 *
 * Why in-process: OpenClaw v2026.8.1 sandboxes exec secret providers, blocking
 * filesystem writes and network access — which breaks `op read` and any other
 * network-dependent exec resolver. Running inside the Gateway process avoids the
 * sandbox entirely, so the official `@1password/sdk` can reach the 1Password API
 * over HTTPS normally.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import {
  parsePluginConfig,
  readServiceAccountToken,
  type OnePasswordPluginConfig,
} from "./config.js";
import { createOnePasswordClient, type OnePasswordClient } from "./op-client.js";
import { syncSecrets, type StoreWriter, type SyncLogger } from "./secret-sync.js";
import { readExistingKeyCount, syncSecretsToFile } from "./file-sync.js";
import { createTools } from "./tools.js";
import { PLUGIN_ID, PLUGIN_VERSION } from "./version.js";

const SERVICE_ID = "onepassword-secret-sync";
const STORE_SET_METHOD = "secrets.store.set";

/** Combined result of the store sync and file sync passes. */
interface UnifiedSyncResult {
  /** Store keys written to the OpenClaw shared store. */
  written: string[];
  /** File keys written to the JSON sync file. */
  fileWritten: string[];
  /** Total configured references across both modes. */
  total: number;
  /** Key -> message for references that failed to resolve (either mode). */
  resolveErrors: Record<string, string>;
  /** Store key -> message for values that resolved but failed to store. */
  storeErrors: Record<string, string>;
  /** File key -> message when persisting the sync file failed. */
  fileErrors: Record<string, string>;
}

function unifiedSyncIsClean(result: UnifiedSyncResult): boolean {
  return (
    Object.keys(result.resolveErrors).length === 0 &&
    Object.keys(result.storeErrors).length === 0 &&
    Object.keys(result.fileErrors).length === 0
  );
}

/**
 * StoreWriter backed by the `secrets.store.set` Gateway RPC dispatched through
 * the trusted plugin runtime. Retries briefly while the Gateway request context
 * is still coming up during cold start.
 */
function createStoreWriter(api: OpenClawPluginApi): StoreWriter {
  return {
    async write(name: string, value: string): Promise<void> {
      const gateway = api.runtime?.gateway;
      if (!gateway) {
        throw new Error("plugin runtime gateway is unavailable; cannot write to the secret store");
      }
      const deadline = Date.now() + 10_000;
      let lastError: unknown;
      // The gateway request context may not be ready the instant a startup
      // service runs; retry with backoff until it is (or we give up).
      for (let attempt = 0; ; attempt++) {
        try {
          if (await gateway.isAvailable()) {
            await gateway.request(STORE_SET_METHOD, { name, value });
            return;
          }
          lastError = new Error("gateway request context not yet available");
        } catch (err) {
          lastError = err;
        }
        if (Date.now() >= deadline) break;
        await delay(Math.min(1000, 100 * 2 ** attempt));
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lazily create and memoize a 1Password client from the configured token. */
function createClientFactory(config: OnePasswordPluginConfig): () => Promise<OnePasswordClient> {
  let cached: Promise<OnePasswordClient> | undefined;
  return () => {
    if (!cached) {
      const token = readServiceAccountToken(config);
      if (!token) {
        return Promise.reject(
          new Error(
            `1Password service account token not found. Set the ${config.serviceAccountTokenEnvVar} environment variable on the Gateway process.`,
          ),
        );
      }
      cached = createOnePasswordClient({
        token,
        integrationName: config.integrationName,
        integrationVersion: PLUGIN_VERSION,
        requestTimeoutMs: config.requestTimeoutMs,
      }).catch((err) => {
        cached = undefined; // allow retry on next call
        throw err;
      });
    }
    return cached;
  };
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "1Password",
  description:
    "Resolve 1Password secrets in-process into the OpenClaw store, and expose 1Password vault/item tools to agents.",
  register(api: OpenClawPluginApi) {
    const logger = api.logger as SyncLogger | undefined;

    let config: OnePasswordPluginConfig;
    try {
      config = parsePluginConfig(api.pluginConfig);
    } catch (err) {
      // Surface config errors loudly; do not register anything with bad config.
      logger?.error?.(
        `onepassword: invalid plugin config: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const getClient = createClientFactory(config);
    const store = createStoreWriter(api);

    const storeKeyCount = Object.keys(config.secrets).length;
    const fileKeyCount = config.syncToFile ? Object.keys(config.syncToFile.secrets).length : 0;
    const hasSyncWork = storeKeyCount > 0 || fileKeyCount > 0;

    // Resolve configured references from 1Password and write them to the store
    // and/or the JSON sync file, merging both passes into one result.
    const runSync = async (): Promise<UnifiedSyncResult> => {
      const client = await getClient();
      const result: UnifiedSyncResult = {
        written: [],
        fileWritten: [],
        total: 0,
        resolveErrors: {},
        storeErrors: {},
        fileErrors: {},
      };
      if (storeKeyCount > 0) {
        const r = await syncSecrets({ client, store, secrets: config.secrets, logger });
        result.written = r.written;
        result.total += r.total;
        Object.assign(result.resolveErrors, r.resolveErrors);
        result.storeErrors = r.storeErrors;
      }
      if (config.syncToFile) {
        const f = await syncSecretsToFile({
          client,
          path: config.syncToFile.path,
          secrets: config.syncToFile.secrets,
          logger,
        });
        result.fileWritten = f.fileWritten;
        result.total += f.total;
        Object.assign(result.resolveErrors, f.resolveErrors);
        result.fileErrors = f.fileErrors;
      }
      return result;
    };

    // --- Startup / reload sync service -----------------------------------
    api.registerService({
      id: SERVICE_ID,
      async start() {
        // On startup, report whether a previous boot left a populated sync file.
        if (config.syncToFile) {
          const count = await readExistingKeyCount(config.syncToFile.path);
          if (count !== undefined) {
            logger?.info?.(
              `onepassword: existing sync file ${config.syncToFile.path} has ${count} key(s)`,
            );
          }
        }
        if (!config.syncOnStartup) {
          logger?.debug?.("onepassword: syncOnStartup disabled; skipping startup sync");
          return;
        }
        if (!hasSyncWork) {
          logger?.debug?.("onepassword: no secrets configured; nothing to sync at startup");
          return;
        }
        if (!readServiceAccountToken(config)) {
          const message = `onepassword: ${config.serviceAccountTokenEnvVar} is not set; cannot sync secrets at startup`;
          if (config.failFastOnStartup) throw new Error(message);
          logger?.warn?.(message);
          return;
        }
        try {
          const result = await runSync();
          if (config.failFastOnStartup && !unifiedSyncIsClean(result)) {
            const done = result.written.length + result.fileWritten.length;
            throw new Error(
              `onepassword: startup sync failed for ${result.total - done} of ${result.total} secret(s)`,
            );
          }
        } catch (err) {
          if (config.failFastOnStartup) throw err;
          logger?.error?.(
            `onepassword: startup sync error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    });

    // --- Gateway methods --------------------------------------------------
    // onepassword.sync — re-fetch every configured secret from 1Password and
    // write it into the store. This is what makes fresh values available at
    // runtime (analogous to, and composable with, `openclaw secrets reload`).
    api.registerGatewayMethod(
      "onepassword.sync",
      async ({ respond }) => {
        try {
          const result = await runSync();
          respond(true, {
            written: result.written,
            fileWritten: result.fileWritten,
            total: result.total,
            resolveErrors: result.resolveErrors,
            storeErrors: result.storeErrors,
            fileErrors: result.fileErrors,
          });
        } catch (err) {
          respond(false, undefined, {
            code: "ONEPASSWORD_SYNC_FAILED",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
      { scope: "operator.admin" },
    );

    // onepassword.status — cheap health/config summary (no secret values).
    api.registerGatewayMethod(
      "onepassword.status",
      ({ respond }) => {
        respond(true, {
          version: PLUGIN_VERSION,
          serviceAccountTokenEnvVar: config.serviceAccountTokenEnvVar,
          tokenPresent: readServiceAccountToken(config) !== undefined,
          syncOnStartup: config.syncOnStartup,
          managedStoreKeys: Object.keys(config.secrets),
          syncToFileEnabled: config.syncToFile !== undefined,
          managedFileKeys: config.syncToFile ? Object.keys(config.syncToFile.secrets) : [],
          filePath: config.syncToFile?.path ?? null,
          toolsEnabled: config.tools.enabled,
          toolsWriteEnabled: config.tools.allowWrite,
        });
      },
      { scope: "operator.admin" },
    );

    // --- Agent tools (optional) ------------------------------------------
    if (config.tools.enabled) {
      const tools = createTools({ getClient, allowWrite: config.tools.allowWrite });
      for (const tool of tools) {
        // Boundary cast: PluginTool is a structural subset of the SDK's tool type.
        api.registerTool(tool as never, { optional: true });
      }
      logger?.debug?.(
        `onepassword: registered ${tools.length} agent tool(s) (write=${config.tools.allowWrite})`,
      );
    }

    logger?.info?.(`onepassword plugin v${PLUGIN_VERSION} registered`);
  },
});
