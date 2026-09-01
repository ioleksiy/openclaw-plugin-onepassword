import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PLUGIN_VERSION } from "../src/version.js";

describe("plugin version", () => {
  it("matches package.json version", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { version: string };
    expect(PLUGIN_VERSION).toBe(pkg.version);
  });

  it("matches openclaw.plugin.json version", () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../openclaw.plugin.json", import.meta.url)), "utf8"),
    ) as { version: string };
    expect(PLUGIN_VERSION).toBe(manifest.version);
  });
});
