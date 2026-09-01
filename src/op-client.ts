/**
 * Thin, testable wrapper over the official `@1password/sdk`.
 *
 * The wrapper exists so the rest of the plugin depends on a small, stable
 * interface ({@link OnePasswordClient}) rather than the SDK surface directly,
 * which keeps unit tests fast (no network, no real SDK) and isolates us from
 * SDK churn.
 */

import type { Client, Item, ItemCreateParams, ItemOverview, VaultOverview } from "@1password/sdk";

import { PLUGIN_VERSION } from "./version.js";

export interface ResolveResult {
  /** Resolved values keyed by the original reference. */
  values: Record<string, string>;
  /** References that failed, keyed by reference -> error message. */
  errors: Record<string, string>;
}

/** The stable surface the rest of the plugin relies on. */
export interface OnePasswordClient {
  resolve(reference: string): Promise<string>;
  resolveAll(references: string[]): Promise<ResolveResult>;
  listVaults(): Promise<VaultOverview[]>;
  listItems(vaultId: string): Promise<ItemOverview[]>;
  getItem(vaultId: string, itemId: string): Promise<Item>;
  createItem(params: ItemCreateParams): Promise<Item>;
  updateItem(item: Item): Promise<Item>;
  deleteItem(vaultId: string, itemId: string): Promise<void>;
}

export interface CreateClientOptions {
  token: string;
  integrationName: string;
  integrationVersion?: string;
  /** Per-operation timeout in milliseconds. */
  requestTimeoutMs?: number;
}

/** Reject a promise that does not settle within `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!ms || ms <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`1Password operation "${label}" timed out after ${ms}ms`));
    }, ms);
    // Do not keep the event loop alive solely for this timer.
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveAllUnsupported(err: unknown): boolean {
  // Older SDKs may not implement resolveAll; fall back to per-ref resolve.
  return (
    err instanceof TypeError ||
    (err instanceof Error && /resolveAll is not a function/i.test(err.message))
  );
}

class SdkOnePasswordClient implements OnePasswordClient {
  constructor(
    private readonly client: Client,
    private readonly timeoutMs: number,
  ) {}

  resolve(reference: string): Promise<string> {
    return withTimeout(this.client.secrets.resolve(reference), this.timeoutMs, "secrets.resolve");
  }

  async resolveAll(references: string[]): Promise<ResolveResult> {
    const values: Record<string, string> = {};
    const errors: Record<string, string> = {};
    if (references.length === 0) return { values, errors };

    // Prefer the batched SDK call when available.
    try {
      const response = await withTimeout(
        this.client.secrets.resolveAll(references),
        this.timeoutMs,
        "secrets.resolveAll",
      );
      for (const [reference, entry] of Object.entries(response.individualResponses ?? {})) {
        if (entry?.content?.secret !== undefined) {
          values[reference] = entry.content.secret;
        } else if (entry?.error) {
          errors[reference] = entry.error.message ?? String(entry.error.type ?? "unknown error");
        }
      }
      // Any reference the batch response omitted is treated as an error below.
      for (const reference of references) {
        if (!(reference in values) && !(reference in errors)) {
          errors[reference] = "1Password returned no response for this reference";
        }
      }
      return { values, errors };
    } catch (err) {
      if (!resolveAllUnsupported(err)) {
        // Batch call failed wholesale (e.g. auth/timeout). Fall through to
        // per-reference resolution so a single bad ref does not sink the rest.
      }
    }

    await Promise.all(
      references.map(async (reference) => {
        try {
          values[reference] = await this.resolve(reference);
        } catch (err) {
          errors[reference] = err instanceof Error ? err.message : String(err);
        }
      }),
    );
    return { values, errors };
  }

  listVaults(): Promise<VaultOverview[]> {
    return withTimeout(this.client.vaults.list(), this.timeoutMs, "vaults.list");
  }

  listItems(vaultId: string): Promise<ItemOverview[]> {
    return withTimeout(this.client.items.list(vaultId), this.timeoutMs, "items.list");
  }

  getItem(vaultId: string, itemId: string): Promise<Item> {
    return withTimeout(this.client.items.get(vaultId, itemId), this.timeoutMs, "items.get");
  }

  createItem(params: ItemCreateParams): Promise<Item> {
    return withTimeout(this.client.items.create(params), this.timeoutMs, "items.create");
  }

  updateItem(item: Item): Promise<Item> {
    return withTimeout(this.client.items.put(item), this.timeoutMs, "items.put");
  }

  deleteItem(vaultId: string, itemId: string): Promise<void> {
    return withTimeout(this.client.items.delete(vaultId, itemId), this.timeoutMs, "items.delete");
  }
}

/**
 * Create an authenticated {@link OnePasswordClient}. The `@1password/sdk`
 * package is imported dynamically so it is only loaded when 1Password access is
 * actually used, keeping gateway startup cheap for operators who install but do
 * not configure the plugin.
 */
export async function createOnePasswordClient(
  options: CreateClientOptions,
): Promise<OnePasswordClient> {
  if (!options.token || options.token.trim().length === 0) {
    throw new Error("A 1Password service account token is required to create a client.");
  }
  const { createClient } = await import("@1password/sdk");
  const client = await createClient({
    auth: options.token,
    integrationName: options.integrationName,
    integrationVersion: options.integrationVersion ?? PLUGIN_VERSION,
  });
  return new SdkOnePasswordClient(client, options.requestTimeoutMs ?? 0);
}
