import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_INTEGRATION_NAME,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TOKEN_ENV_VAR,
  parsePluginConfig,
  parseSecretsMap,
  readServiceAccountToken,
} from "../src/config.js";

describe("parsePluginConfig", () => {
  it("applies defaults for an empty config", () => {
    const config = parsePluginConfig(undefined);
    expect(config.serviceAccountTokenEnvVar).toBe(DEFAULT_TOKEN_ENV_VAR);
    expect(config.integrationName).toBe(DEFAULT_INTEGRATION_NAME);
    expect(config.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(config.syncOnStartup).toBe(true);
    expect(config.failFastOnStartup).toBe(false);
    expect(config.secrets).toEqual({});
    expect(config.tools).toEqual({ enabled: false, allowWrite: false });
  });

  it("accepts a valid full config", () => {
    const config = parsePluginConfig({
      serviceAccountTokenEnvVar: "MY_OP_TOKEN",
      integrationName: "acme",
      requestTimeoutMs: 5000,
      syncOnStartup: false,
      failFastOnStartup: true,
      secrets: { SLACK_BOT_TOKEN: "op://Vault/SlackBot/bot_token" },
      tools: { enabled: true, allowWrite: true },
    });
    expect(config.serviceAccountTokenEnvVar).toBe("MY_OP_TOKEN");
    expect(config.secrets.SLACK_BOT_TOKEN).toBe("op://Vault/SlackBot/bot_token");
    expect(config.tools).toEqual({ enabled: true, allowWrite: true });
  });

  it("rejects allowWrite without enabled", () => {
    expect(() => parsePluginConfig({ tools: { allowWrite: true } })).toThrow(ConfigError);
  });

  it("rejects a non-positive timeout", () => {
    expect(() => parsePluginConfig({ requestTimeoutMs: 0 })).toThrow(ConfigError);
  });

  it("rejects an empty token env var name", () => {
    expect(() => parsePluginConfig({ serviceAccountTokenEnvVar: "  " })).toThrow(ConfigError);
  });
});

describe("parseSecretsMap", () => {
  it("rejects invalid store keys", () => {
    expect(() => parseSecretsMap({ "lower-case": "op://V/I/f" })).toThrow(/store key/);
    expect(() => parseSecretsMap({ "1LEADING": "op://V/I/f" })).toThrow(/store key/);
  });

  it("rejects non op:// references", () => {
    expect(() => parseSecretsMap({ VALID_KEY: "not-a-ref" })).toThrow(/1Password reference/);
    expect(() => parseSecretsMap({ VALID_KEY: 42 })).toThrow(/1Password reference/);
  });

  it("accepts valid mappings", () => {
    const map = parseSecretsMap({
      OPENAI_API_KEY: "op://Vault/OpenAI/credential",
      A: "op://V/I/f",
    });
    expect(map).toEqual({
      OPENAI_API_KEY: "op://Vault/OpenAI/credential",
      A: "op://V/I/f",
    });
  });
});

describe("readServiceAccountToken", () => {
  it("reads and trims the configured env var", () => {
    const token = readServiceAccountToken({ serviceAccountTokenEnvVar: "OP_TOKEN" }, {
      OP_TOKEN: "  secret-value  ",
    } as NodeJS.ProcessEnv);
    expect(token).toBe("secret-value");
  });

  it("returns undefined when unset or empty", () => {
    expect(
      readServiceAccountToken({ serviceAccountTokenEnvVar: "OP_TOKEN" }, {} as NodeJS.ProcessEnv),
    ).toBeUndefined();
    expect(
      readServiceAccountToken({ serviceAccountTokenEnvVar: "OP_TOKEN" }, {
        OP_TOKEN: "   ",
      } as NodeJS.ProcessEnv),
    ).toBeUndefined();
  });
});
