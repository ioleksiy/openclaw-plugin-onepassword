import { describe, expect, it, vi } from "vitest";

import type { OnePasswordClient, ResolveResult } from "../src/op-client.js";
import { syncResultIsClean, syncSecrets, type StoreWriter } from "../src/secret-sync.js";

function fakeClient(resolveAll: ResolveResult): OnePasswordClient {
  return {
    resolve: vi.fn(),
    resolveAll: vi.fn(async () => resolveAll),
    listVaults: vi.fn(),
    listItems: vi.fn(),
    getItem: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
  } as unknown as OnePasswordClient;
}

function recordingStore(): StoreWriter & { writes: Record<string, string> } {
  const writes: Record<string, string> = {};
  return {
    writes,
    async write(name, value) {
      writes[name] = value;
    },
  };
}

describe("syncSecrets", () => {
  it("returns clean empty result when nothing is configured", async () => {
    const client = fakeClient({ values: {}, errors: {} });
    const store = recordingStore();
    const result = await syncSecrets({ client, store, secrets: {} });
    expect(result.total).toBe(0);
    expect(syncResultIsClean(result)).toBe(true);
    expect(client.resolveAll).not.toHaveBeenCalled();
  });

  it("writes resolved values into the store keyed by store key", async () => {
    const client = fakeClient({
      values: {
        "op://Vault/SlackBot/bot_token": "xoxb-1",
        "op://Vault/OpenAI/credential": "sk-2",
      },
      errors: {},
    });
    const store = recordingStore();
    const result = await syncSecrets({
      client,
      store,
      secrets: {
        SLACK_BOT_TOKEN: "op://Vault/SlackBot/bot_token",
        OPENAI_API_KEY: "op://Vault/OpenAI/credential",
      },
    });
    expect(result.written.sort()).toEqual(["OPENAI_API_KEY", "SLACK_BOT_TOKEN"]);
    expect(store.writes).toEqual({
      SLACK_BOT_TOKEN: "xoxb-1",
      OPENAI_API_KEY: "sk-2",
    });
    expect(syncResultIsClean(result)).toBe(true);
  });

  it("deduplicates references when two keys share one reference", async () => {
    const client = fakeClient({ values: { "op://V/I/f": "val" }, errors: {} });
    const store = recordingStore();
    await syncSecrets({
      client,
      store,
      secrets: { KEY_A: "op://V/I/f", KEY_B: "op://V/I/f" },
    });
    expect(vi.mocked(client.resolveAll).mock.calls[0]?.[0]).toEqual(["op://V/I/f"]);
    expect(store.writes).toEqual({ KEY_A: "val", KEY_B: "val" });
  });

  it("records resolve errors without throwing", async () => {
    const client = fakeClient({
      values: { "op://V/Good/f": "ok" },
      errors: { "op://V/Bad/f": "not found" },
    });
    const store = recordingStore();
    const result = await syncSecrets({
      client,
      store,
      secrets: { GOOD: "op://V/Good/f", BAD: "op://V/Bad/f" },
    });
    expect(result.written).toEqual(["GOOD"]);
    expect(result.resolveErrors).toEqual({ BAD: "not found" });
    expect(syncResultIsClean(result)).toBe(false);
  });

  it("records store errors when writing fails", async () => {
    const client = fakeClient({ values: { "op://V/I/f": "val" }, errors: {} });
    const store: StoreWriter = {
      write: vi.fn(async () => {
        throw new Error("store unavailable");
      }),
    };
    const result = await syncSecrets({ client, store, secrets: { KEY: "op://V/I/f" } });
    expect(result.written).toEqual([]);
    expect(result.storeErrors.KEY).toBe("store unavailable");
    expect(syncResultIsClean(result)).toBe(false);
  });
});
