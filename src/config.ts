/**
 * Plugin configuration parsing and validation.
 *
 * The plugin intentionally hardcodes no vault names, item paths, or field
 * names. Everything 1Password-specific is supplied by the operator: the
 * service-account token comes from an environment variable, and the
 * `op://Vault/Item/Field` references live in the operator's `openclaw.json`.
 */

/** Store keys use OpenClaw's env-var grammar. */
export const STORE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

/** 1Password secret reference grammar, e.g. `op://Vault/Item/field`. */
export const OP_REFERENCE_PATTERN = /^op:\/\/[^/]+\/.+/;

export const DEFAULT_TOKEN_ENV_VAR = "OP_SERVICE_ACCOUNT_TOKEN";
export const DEFAULT_INTEGRATION_NAME = "openclaw-plugin-onepassword";
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface OnePasswordToolsConfig {
  enabled: boolean;
  allowWrite: boolean;
}

export type SyncToFileMode = "json";

export interface SyncToFileConfig {
  /** Absolute path of the JSON file to write inside the OpenClaw data volume. */
  path: string;
  /** File format. Only "json" (flat object, JSON-pointer ids) is supported. */
  mode: SyncToFileMode;
  /** Map of file key -> 1Password secret reference. */
  secrets: Record<string, string>;
}

export interface OnePasswordPluginConfig {
  serviceAccountTokenEnvVar: string;
  integrationName: string;
  requestTimeoutMs: number;
  syncOnStartup: boolean;
  failFastOnStartup: boolean;
  /** Map of OpenClaw store key -> 1Password secret reference (store sync). */
  secrets: Record<string, string>;
  /** Optional JSON-file sync, for channels that reject `source: "store"`. */
  syncToFile?: SyncToFileConfig;
  tools: OnePasswordToolsConfig;
}

export class ConfigError extends Error {
  public override readonly name = "ConfigError";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`"${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ConfigError(`"${field}" must be a boolean.`);
  }
  return value;
}

function optionalPositiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`"${field}" must be a positive number.`);
  }
  return value;
}

/** Validate a `key -> op://...` secrets mapping. `label` names it in errors. */
export function parseSecretsMap(value: unknown, label = "secrets"): Record<string, string> {
  const raw = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, ref] of Object.entries(raw)) {
    if (!STORE_KEY_PATTERN.test(key)) {
      throw new ConfigError(
        `${label} key "${key}" is invalid; keys must match ${STORE_KEY_PATTERN.source} (uppercase env-var grammar).`,
      );
    }
    if (typeof ref !== "string" || !OP_REFERENCE_PATTERN.test(ref)) {
      throw new ConfigError(
        `${label}["${key}"] must be a 1Password reference like "op://Vault/Item/field"; got ${JSON.stringify(ref)}.`,
      );
    }
    out[key] = ref;
  }
  return out;
}

/** Parse and validate the optional `syncToFile` block. */
export function parseSyncToFile(value: unknown): SyncToFileConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError('"syncToFile" must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const path = optionalString(raw.path, "syncToFile.path");
  if (!path) {
    throw new ConfigError('"syncToFile.path" is required and must be a non-empty string.');
  }
  const mode = optionalString(raw.mode, "syncToFile.mode") ?? "json";
  if (mode !== "json") {
    throw new ConfigError('"syncToFile.mode" must be "json" (the only supported mode).');
  }
  const secrets = parseSecretsMap(raw.secrets, "syncToFile.secrets");
  if (Object.keys(secrets).length === 0) {
    throw new ConfigError('"syncToFile.secrets" must contain at least one key -> op:// mapping.');
  }
  return { path, mode, secrets };
}

function parseTools(value: unknown): OnePasswordToolsConfig {
  const raw = asRecord(value);
  const enabled = optionalBoolean(raw.enabled, "tools.enabled") ?? false;
  const allowWrite = optionalBoolean(raw.allowWrite, "tools.allowWrite") ?? false;
  if (allowWrite && !enabled) {
    throw new ConfigError('"tools.allowWrite" requires "tools.enabled" to be true.');
  }
  return { enabled, allowWrite };
}

/**
 * Parse and validate the plugin config, applying defaults. Throws
 * {@link ConfigError} on any invalid input so misconfiguration surfaces at
 * startup instead of at first secret resolution.
 */
export function parsePluginConfig(input: unknown): OnePasswordPluginConfig {
  const raw = asRecord(input);
  return {
    serviceAccountTokenEnvVar:
      optionalString(raw.serviceAccountTokenEnvVar, "serviceAccountTokenEnvVar") ??
      DEFAULT_TOKEN_ENV_VAR,
    integrationName:
      optionalString(raw.integrationName, "integrationName") ?? DEFAULT_INTEGRATION_NAME,
    requestTimeoutMs:
      optionalPositiveNumber(raw.requestTimeoutMs, "requestTimeoutMs") ??
      DEFAULT_REQUEST_TIMEOUT_MS,
    syncOnStartup: optionalBoolean(raw.syncOnStartup, "syncOnStartup") ?? true,
    failFastOnStartup: optionalBoolean(raw.failFastOnStartup, "failFastOnStartup") ?? false,
    secrets: parseSecretsMap(raw.secrets),
    syncToFile: parseSyncToFile(raw.syncToFile),
    tools: parseTools(raw.tools),
  };
}

/**
 * Read the service account token from the configured environment variable.
 * Returns `undefined` when the variable is unset or empty so callers can
 * decide whether that is fatal (startup sync) or merely degrading (tools).
 */
export function readServiceAccountToken(
  config: Pick<OnePasswordPluginConfig, "serviceAccountTokenEnvVar">,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = env[config.serviceAccountTokenEnvVar];
  if (typeof token !== "string" || token.trim().length === 0) {
    return undefined;
  }
  return token.trim();
}
