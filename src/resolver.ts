/**
 * Standalone exec secret resolver (OPTIONAL / ADVANCED).
 *
 * OpenClaw's `secretProviderIntegrations` feature runs this file as
 * `node dist/resolver.js` (a child process) and speaks a small JSON protocol
 * over stdin/stdout:
 *
 *   request:  { "protocolVersion": 1, "provider": "op", "ids": ["op://Vault/Item/field"] }
 *   response: { "protocolVersion": 1, "values": { "op://Vault/Item/field": "<secret>" } }
 *
 * IMPORTANT: because this runs as an *exec* secret provider, it is subject to
 * the v2026.8.1 exec sandbox that blocks filesystem writes and network access.
 * It therefore only works when the operator has allowlisted the 1Password API
 * host for secret egress (see README → "Exec resolver mode"). For most setups,
 * prefer the in-process store sync, which is not sandboxed.
 *
 * This module intentionally imports nothing from `openclaw` so it stays a
 * lightweight, independently testable leaf.
 */

import { createOnePasswordClient } from "./op-client.js";
import {
  DEFAULT_INTEGRATION_NAME,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TOKEN_ENV_VAR,
} from "./config.js";

interface ResolverRequest {
  protocolVersion?: number;
  provider?: string;
  ids?: string[];
}

interface ResolverResponse {
  protocolVersion: 1;
  values: Record<string, string>;
  errors?: Record<string, { code: string; message?: string }>;
}

const NOT_FOUND = "NOT_FOUND";
const UNAVAILABLE = "UNAVAILABLE";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function parseRequest(input: string): ResolverRequest {
  const trimmed = input.trim();
  if (trimmed.length === 0) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("resolver request must be a JSON object");
  }
  return parsed as ResolverRequest;
}

export async function resolveRequest(
  request: ResolverRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolverResponse> {
  const ids = Array.isArray(request.ids) ? request.ids.filter((id) => typeof id === "string") : [];
  const response: ResolverResponse = { protocolVersion: 1, values: {} };
  if (ids.length === 0) return response;

  const tokenEnvVar = env.OP_RESOLVER_TOKEN_ENV_VAR?.trim() || DEFAULT_TOKEN_ENV_VAR;
  const token = env[tokenEnvVar]?.trim();
  if (!token) {
    response.errors = {};
    for (const id of ids) {
      response.errors[id] = {
        code: UNAVAILABLE,
        message: `service account token env var ${tokenEnvVar} is not set`,
      };
    }
    return response;
  }

  const client = await createOnePasswordClient({
    token,
    integrationName: env.OP_INTEGRATION_NAME?.trim() || DEFAULT_INTEGRATION_NAME,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  });

  const { values, errors } = await client.resolveAll(ids);
  response.values = values;
  const errorEntries = Object.entries(errors);
  if (errorEntries.length > 0) {
    response.errors = {};
    for (const [id, message] of errorEntries) {
      const code = /not\s*found|no item|no vault/i.test(message) ? NOT_FOUND : UNAVAILABLE;
      response.errors[id] = { code, message };
    }
  }
  return response;
}

/** CLI entrypoint: read a request from stdin, print a response to stdout. */
export async function main(): Promise<void> {
  try {
    const request = parseRequest(await readStdin());
    const response = await resolveRequest(request);
    process.stdout.write(JSON.stringify(response));
  } catch (err) {
    // Never leak error internals to stdout (may contain credential material).
    process.stderr.write(
      `onepassword resolver error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.stdout.write(JSON.stringify({ protocolVersion: 1, values: {} }));
    process.exitCode = 1;
  }
}

// Run only when executed directly (node dist/resolver.js), not when imported by tests.
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("/resolver.js") || invokedPath.endsWith("/resolver.ts")) {
  void main();
}
