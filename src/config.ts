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

export interface OnePasswordPluginConfig {
  serviceAccountTokenEnvVar: string;
  integrationName: string;
  requestTimeoutMs: number;
  syncOnStartup: boolean;
  failFastOnStartup: boolean;
  /** Map of OpenClaw store key -> 1Password secret reference. */
  secrets: Record<string, string>;
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

/** Validate a single `storeKey -> op://...` secrets mapping. */
export function parseSecretsMap(value: unknown): Record<string, string> {
  const raw = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, ref] of Object.entries(raw)) {
    if (!STORE_KEY_PATTERN.test(key)) {
      throw new ConfigError(
        `secrets store key "${key}" is invalid; keys must match ${STORE_KEY_PATTERN.source} (uppercase env-var grammar).`,
      );
    }
    if (typeof ref !== "string" || !OP_REFERENCE_PATTERN.test(ref)) {
      throw new ConfigError(
        `secrets["${key}"] must be a 1Password reference like "op://Vault/Item/field"; got ${JSON.stringify(ref)}.`,
      );
    }
    out[key] = ref;
  }
  return out;
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
