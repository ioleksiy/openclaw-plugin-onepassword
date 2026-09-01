import { describe, expect, it, vi } from "vitest";

import type { OnePasswordClient } from "../src/op-client.js";
import { createTools } from "../src/tools.js";

function clientStub(overrides: Partial<OnePasswordClient> = {}): OnePasswordClient {
  return {
    resolve: vi.fn(async () => "secret"),
    resolveAll: vi.fn(),
    listVaults: vi.fn(async () => [{ id: "v1", title: "Vault" }] as never),
    listItems: vi.fn(async () => [] as never),
    getItem: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(async () => {}),
    ...overrides,
  } as unknown as OnePasswordClient;
}

describe("createTools", () => {
  it("registers only read tools when write is disabled", () => {
    const tools = createTools({ getClient: async () => clientStub(), allowWrite: false });
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "1password_list_vaults",
      "1password_list_items",
      "1password_get_item",
      "1password_read_field",
    ]);
  });

  it("adds write tools when allowWrite is true", () => {
    const tools = createTools({ getClient: async () => clientStub(), allowWrite: true });
    const names = tools.map((t) => t.name);
    expect(names).toContain("1password_create_item");
    expect(names).toContain("1password_update_item");
    expect(names).toContain("1password_delete_item");
  });

  it("redacts concealed fields by default in get_item", async () => {
    const client = clientStub({
      getItem: vi.fn(
        async () =>
          ({
            id: "i1",
            title: "Login",
            category: "Login",
            vaultId: "v1",
            tags: [],
            notes: "",
            fields: [
              { id: "u", title: "username", fieldType: "Text", value: "alice" },
              { id: "p", title: "password", fieldType: "Concealed", value: "hunter2" },
            ],
          }) as never,
      ),
    });
    const tools = createTools({ getClient: async () => client, allowWrite: false });
    const getItem = tools.find((t) => t.name === "1password_get_item");
    const result = await getItem!.execute("call-1", { vaultId: "v1", itemId: "i1" });
    const details = result.details as { fields: Array<{ title: string; value: string }> };
    const password = details.fields.find((f) => f.title === "password");
    expect(password?.value).toBe("<concealed>");
    const username = details.fields.find((f) => f.title === "username");
    expect(username?.value).toBe("alice");
  });

  it("returns concealed values when includeSecrets is true", async () => {
    const client = clientStub({
      getItem: vi.fn(
        async () =>
          ({
            id: "i1",
            title: "Login",
            category: "Login",
            vaultId: "v1",
            tags: [],
            notes: "",
            fields: [{ id: "p", title: "password", fieldType: "Concealed", value: "hunter2" }],
          }) as never,
      ),
    });
    const tools = createTools({ getClient: async () => client, allowWrite: false });
    const getItem = tools.find((t) => t.name === "1password_get_item");
    const result = await getItem!.execute("call-1", {
      vaultId: "v1",
      itemId: "i1",
      includeSecrets: true,
    });
    const details = result.details as { fields: Array<{ title: string; value: string }> };
    expect(details.fields[0]?.value).toBe("hunter2");
  });
});
