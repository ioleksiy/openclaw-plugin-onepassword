/**
 * In-process secret synchronization.
 *
 * This is the mechanism that bypasses the OpenClaw exec secret sandbox: instead
 * of running `op` (or any resolver) as a sandboxed child process, the plugin
 * runs inside the Gateway process, fetches values from 1Password over HTTPS
 * using the official SDK, and writes them into OpenClaw's shared secret store.
 * Operators then reference those values with `source: "store"`.
 */

import type { OnePasswordClient } from "./op-client.js";

/** Minimal logger surface (compatible with OpenClaw's PluginLogger). */
export interface SyncLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
}

/**
 * Writes a resolved secret into OpenClaw's shared store.
 *
 * Implemented in {@link file://./index.ts} by dispatching the
 * `secrets.store.set` Gateway method through `api.runtime.gateway.request`,
 * which persists the value (team scope) and triggers a live runtime refresh so
 * dependent channels/providers pick it up without a restart.
 */
export interface StoreWriter {
  write(name: string, value: string): Promise<void>;
}

export interface SyncOptions {
  client: OnePasswordClient;
  store: StoreWriter;
  /** Map of store key -> op:// reference. */
  secrets: Record<string, string>;
  logger?: SyncLogger;
}

export interface SyncResult {
  /** Store keys successfully fetched and written. */
  written: string[];
  /** Store key -> error message for references that failed to resolve. */
  resolveErrors: Record<string, string>;
  /** Store key -> error message for values that resolved but failed to store. */
  storeErrors: Record<string, string>;
  /** Total number of configured references. */
  total: number;
}

export function syncResultIsClean(result: SyncResult): boolean {
  return (
    Object.keys(result.resolveErrors).length === 0 && Object.keys(result.storeErrors).length === 0
  );
}

/**
 * Resolve every configured reference from 1Password and write it into the
 * store. Individual failures are collected rather than thrown so one bad
 * reference cannot prevent the rest of the secrets from loading. The caller
 * decides whether a partial failure is fatal (see `failFastOnStartup`).
 */
export async function syncSecrets(options: SyncOptions): Promise<SyncResult> {
  const { client, store, secrets, logger } = options;
  const entries = Object.entries(secrets);
  const result: SyncResult = {
    written: [],
    resolveErrors: {},
    storeErrors: {},
    total: entries.length,
  };

  if (entries.length === 0) {
    logger?.debug?.("onepassword: no secrets configured to sync");
    return result;
  }

  // Resolve references in a single batch. Map references back to store keys;
  // note two store keys may point at the same reference.
  const references = [...new Set(entries.map(([, ref]) => ref))];
  const { values, errors } = await client.resolveAll(references);

  for (const [key, reference] of entries) {
    const value = values[reference];
    if (value === undefined) {
      const message = errors[reference] ?? "reference did not resolve";
      result.resolveErrors[key] = message;
      logger?.warn?.(`onepassword: failed to resolve ${key} (${reference}): ${message}`);
      continue;
    }
    try {
      await store.write(key, value);
      result.written.push(key);
      logger?.debug?.(`onepassword: stored ${key} from ${reference}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.storeErrors[key] = message;
      logger?.error?.(`onepassword: failed to store ${key}: ${message}`);
    }
  }

  const failed = Object.keys(result.resolveErrors).length + Object.keys(result.storeErrors).length;
  if (failed === 0) {
    logger?.info?.(`onepassword: synced ${result.written.length} secret(s) into the store`);
  } else {
    logger?.warn?.(
      `onepassword: synced ${result.written.length}/${result.total} secret(s); ${failed} failed`,
    );
  }
  return result;
}
