import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { OnePasswordClient, ResolveResult } from "../src/op-client.js";
import { readExistingKeyCount, syncSecretsToFile } from "../src/file-sync.js";

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

const dirs: string[] = [];
async function tempFile(name = "op-secrets.json"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "op-plugin-"));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncSecretsToFile", () => {
  it("writes a flat JSON object of resolved values", async () => {
    const path = await tempFile();
    const client = fakeClient({
      values: {
        "op://V/Slack/bot": "xoxb-1",
        "op://V/Slack/app": "xapp-1",
      },
      errors: {},
    });
    const result = await syncSecretsToFile({
      client,
      path,
      secrets: { SLACK_BOT_TOKEN_A: "op://V/Slack/bot", SLACK_APP_TOKEN_A: "op://V/Slack/app" },
    });
    expect(result.fileWritten.sort()).toEqual(["SLACK_APP_TOKEN_A", "SLACK_BOT_TOKEN_A"]);
    expect(result.total).toBe(2);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    expect(parsed).toEqual({ SLACK_BOT_TOKEN_A: "xoxb-1", SLACK_APP_TOKEN_A: "xapp-1" });
  });

  it("writes the file with 0600 permissions", async () => {
    const path = await tempFile();
    const client = fakeClient({ values: { "op://V/I/f": "v" }, errors: {} });
    await syncSecretsToFile({ client, path, secrets: { KEY: "op://V/I/f" } });
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("records resolve errors and keeps last-known-good values", async () => {
    const path = await tempFile();
    // Seed an existing file so the failed key can be carried forward.
    await writeFile(path, JSON.stringify({ KEEP: "old-value", FRESH: "old-fresh" }), {
      mode: 0o600,
    });
    const client = fakeClient({
      values: { "op://V/Fresh/f": "new-fresh" },
      errors: { "op://V/Missing/f": "no item matched" },
    });
    const result = await syncSecretsToFile({
      client,
      path,
      secrets: { FRESH: "op://V/Fresh/f", KEEP: "op://V/Missing/f" },
    });
    expect(result.fileWritten).toEqual(["FRESH"]);
    expect(result.resolveErrors.KEEP).toBe("no item matched");
    const parsed = JSON.parse(await readFile(path, "utf8"));
    // FRESH updated, KEEP preserved from the previous file.
    expect(parsed).toEqual({ FRESH: "new-fresh", KEEP: "old-value" });
  });

  it("leaves the file unchanged when nothing resolves and no prior value exists", async () => {
    const path = await tempFile();
    const client = fakeClient({ values: {}, errors: { "op://V/I/f": "boom" } });
    const result = await syncSecretsToFile({ client, path, secrets: { KEY: "op://V/I/f" } });
    expect(result.fileWritten).toEqual([]);
    expect(result.resolveErrors.KEY).toBe("boom");
    await expect(stat(path)).rejects.toThrow(); // file was never created
  });

  it("deduplicates references shared by multiple keys", async () => {
    const path = await tempFile();
    const client = fakeClient({ values: { "op://V/I/f": "v" }, errors: {} });
    await syncSecretsToFile({
      client,
      path,
      secrets: { KEY_A: "op://V/I/f", KEY_B: "op://V/I/f" },
    });
    expect(vi.mocked(client.resolveAll).mock.calls[0]?.[0]).toEqual(["op://V/I/f"]);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    expect(parsed).toEqual({ KEY_A: "v", KEY_B: "v" });
  });
});

describe("readExistingKeyCount", () => {
  it("returns the key count of an existing file", async () => {
    const path = await tempFile();
    await writeFile(path, JSON.stringify({ A: "1", B: "2" }));
    expect(await readExistingKeyCount(path)).toBe(2);
  });

  it("returns undefined for a missing file", async () => {
    expect(await readExistingKeyCount(join(tmpdir(), "does-not-exist-op.json"))).toBeUndefined();
  });
});
