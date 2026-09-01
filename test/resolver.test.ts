import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OnePasswordClient, ResolveResult } from "../src/op-client.js";

const resolveAllMock = vi.fn<(refs: string[]) => Promise<ResolveResult>>();

vi.mock("../src/op-client.js", () => ({
  createOnePasswordClient: vi.fn(
    async (): Promise<OnePasswordClient> =>
      ({
        resolveAll: resolveAllMock,
      }) as unknown as OnePasswordClient,
  ),
}));

const { resolveRequest } = await import("../src/resolver.js");

describe("resolveRequest", () => {
  beforeEach(() => {
    resolveAllMock.mockReset();
  });

  it("returns empty values for an empty id list", async () => {
    const res = await resolveRequest({ protocolVersion: 1, ids: [] }, {} as NodeJS.ProcessEnv);
    expect(res).toEqual({ protocolVersion: 1, values: {} });
    expect(resolveAllMock).not.toHaveBeenCalled();
  });

  it("reports UNAVAILABLE for every id when the token env var is missing", async () => {
    const res = await resolveRequest(
      { protocolVersion: 1, ids: ["op://V/I/f"] },
      {} as NodeJS.ProcessEnv,
    );
    expect(res.values).toEqual({});
    expect(res.errors?.["op://V/I/f"]?.code).toBe("UNAVAILABLE");
    expect(resolveAllMock).not.toHaveBeenCalled();
  });

  it("resolves values when a token is present", async () => {
    resolveAllMock.mockResolvedValue({ values: { "op://V/I/f": "secret" }, errors: {} });
    const res = await resolveRequest({ protocolVersion: 1, ids: ["op://V/I/f"] }, {
      OP_SERVICE_ACCOUNT_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(res.values).toEqual({ "op://V/I/f": "secret" });
    expect(res.errors).toBeUndefined();
  });

  it("maps not-found style errors to NOT_FOUND codes", async () => {
    resolveAllMock.mockResolvedValue({
      values: {},
      errors: { "op://V/Missing/f": "no item matched the query" },
    });
    const res = await resolveRequest({ protocolVersion: 1, ids: ["op://V/Missing/f"] }, {
      OP_SERVICE_ACCOUNT_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(res.errors?.["op://V/Missing/f"]?.code).toBe("NOT_FOUND");
  });

  it("honors OP_RESOLVER_TOKEN_ENV_VAR override", async () => {
    resolveAllMock.mockResolvedValue({ values: { "op://V/I/f": "s" }, errors: {} });
    const res = await resolveRequest({ protocolVersion: 1, ids: ["op://V/I/f"] }, {
      OP_RESOLVER_TOKEN_ENV_VAR: "CUSTOM_TOKEN",
      CUSTOM_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(res.values["op://V/I/f"]).toBe("s");
  });
});
