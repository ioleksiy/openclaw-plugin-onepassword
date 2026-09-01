/**
 * File sync mode.
 *
 * Some bundled OpenClaw channel plugins (e.g. Slack) reject `source: "store"`
 * SecretRefs at config-validation time, allowing only `env`, `file`, and
 * `exec`. Since the plugin runs in-process (no exec sandbox), it can resolve
 * `op://` references and write them to a JSON file that OpenClaw's built-in
 * `source: "file"` provider reads — which those channels accept.
 *
 * The file contains plaintext secret values. It must live inside the OpenClaw
 * data volume (same trust boundary as the SQLite store) and outside any path an
 * agent can read. Writes are atomic (temp file + rename) and `0600`.
 */

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { OnePasswordClient } from "./op-client.js";
import type { SyncLogger } from "./secret-sync.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export interface FileSyncOptions {
  client: OnePasswordClient;
  path: string;
  secrets: Record<string, string>;
  logger?: SyncLogger;
}

export interface FileSyncResult {
  /** File keys written with a freshly resolved value this run. */
  fileWritten: string[];
  /** File key -> error message for references that failed to resolve. */
  resolveErrors: Record<string, string>;
  /** File key -> error message when persisting the file failed. */
  fileErrors: Record<string, string>;
  /** Number of configured file keys. */
  total: number;
}

/** Expand a leading `~` to the current user's home directory. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/** Best-effort read of the existing file's flat string map (for last-known-good). */
async function readExistingValues(path: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    // Missing/unreadable/invalid file — treat as empty.
  }
  return {};
}

/** Count keys in an existing sync file, or `undefined` if it can't be read. */
export async function readExistingKeyCount(path: string): Promise<number | undefined> {
  try {
    const parsed = JSON.parse(await readFile(expandHome(path), "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed as Record<string, unknown>).length;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Atomically write `content` to `path` with `0600` perms (temp file + rename). */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, { mode: FILE_MODE });
  try {
    await rename(tmp, path);
  } catch (err) {
    // Clean up the temp file on failure; ignore secondary errors.
    await import("node:fs/promises").then((fs) => fs.rm(tmp, { force: true })).catch(() => {});
    throw err;
  }
  // rename preserves the temp file's mode, but enforce it in case the target
  // pre-existed with looser permissions on some platforms.
  await chmod(path, FILE_MODE).catch(() => {});
}

/**
 * Resolve the configured references and write them to a JSON file. Keys that
 * fail to resolve are reported in `resolveErrors`; if a previous value for such
 * a key exists in the current file it is carried forward (last-known-good) so a
 * transient 1Password failure does not break a running channel.
 */
export async function syncSecretsToFile(options: FileSyncOptions): Promise<FileSyncResult> {
  const { client, secrets, logger } = options;
  const path = expandHome(options.path);
  const entries = Object.entries(secrets);
  const result: FileSyncResult = {
    fileWritten: [],
    resolveErrors: {},
    fileErrors: {},
    total: entries.length,
  };
  if (entries.length === 0) return result;

  const references = [...new Set(entries.map(([, ref]) => ref))];
  const { values, errors } = await client.resolveAll(references);
  const existing = await readExistingValues(path);

  const output: Record<string, string> = {};
  const freshKeys: string[] = [];
  for (const [key, reference] of entries) {
    const value = values[reference];
    if (value !== undefined) {
      output[key] = value;
      freshKeys.push(key);
    } else {
      const message = errors[reference] ?? "reference did not resolve";
      result.resolveErrors[key] = message;
      logger?.warn?.(`onepassword: failed to resolve file key ${key} (${reference}): ${message}`);
      if (existing[key] !== undefined) {
        // Preserve the last-known-good value so the channel keeps working.
        output[key] = existing[key];
        logger?.debug?.(`onepassword: kept last-known-good file value for ${key}`);
      }
    }
  }

  if (Object.keys(output).length === 0) {
    logger?.warn?.(`onepassword: nothing resolved for file sync; leaving ${path} unchanged`);
    return result;
  }

  try {
    await writeFileAtomic(path, JSON.stringify(output, null, 2) + "\n");
    result.fileWritten = freshKeys;
    logger?.info?.(
      `onepassword: wrote ${freshKeys.length} secret(s) to ${path} (${Object.keys(output).length} total keys)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const [key] of entries) result.fileErrors[key] = message;
    logger?.error?.(`onepassword: failed to write ${path}: ${message}`);
  }
  return result;
}
