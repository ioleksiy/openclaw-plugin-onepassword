#!/usr/bin/env node
/**
 * Bump the project version in every place that must stay in sync, and roll the
 * changelog. This is the single supported way to change the version — the three
 * files below MUST agree (a unit test enforces it), so never edit them by hand.
 *
 * Usage:
 *   node scripts/bump-version.mjs <x.y.z>
 *   npm run release:prepare -- <x.y.z>
 *
 * It updates:
 *   - package.json            "version"
 *   - openclaw.plugin.json    "version"
 *   - src/version.ts          PLUGIN_VERSION
 *   - CHANGELOG.md            moves [Unreleased] entries under the new version
 *
 * It does NOT commit, tag, or publish. Review the diff, then commit to main;
 * the Release workflow publishes automatically when the version is new.
 *
 * Edits are surgical (single-field string replacements) to preserve existing
 * formatting, so `npm run verify` stays green without a reformat.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const newVersion = process.argv[2]?.trim();
if (!newVersion || !SEMVER.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.mjs <x.y.z>");
  console.error("Example: node scripts/bump-version.mjs 0.1.1");
  process.exit(1);
}

/** Replace the first `"version": "..."` field, preserving surrounding formatting. */
function bumpJsonVersion(relPath) {
  const path = join(root, relPath);
  const text = readFileSync(path, "utf8");
  const match = text.match(/"version":\s*"([^"]*)"/);
  if (!match) {
    console.error(`Could not find a "version" field in ${relPath}`);
    process.exit(1);
  }
  writeFileSync(path, text.replace(/"version":\s*"[^"]*"/, `"version": "${newVersion}"`));
  return match[1];
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const oldVersion = pkg.version;
if (oldVersion === newVersion) {
  console.error(`Version is already ${newVersion}; nothing to do.`);
  process.exit(1);
}

bumpJsonVersion("package.json");
bumpJsonVersion("openclaw.plugin.json");

// src/version.ts
const versionTsPath = join(root, "src/version.ts");
let versionTs = readFileSync(versionTsPath, "utf8");
if (!/PLUGIN_VERSION = "[^"]*"/.test(versionTs)) {
  console.error("Could not find PLUGIN_VERSION in src/version.ts");
  process.exit(1);
}
writeFileSync(
  versionTsPath,
  versionTs.replace(/PLUGIN_VERSION = "[^"]*"/, `PLUGIN_VERSION = "${newVersion}"`),
);

// Derive the repo web URL from package.json for changelog links.
const repoUrl = (pkg.repository?.url ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "")
  .replace(/^git:/, "https:");

// CHANGELOG.md
const changelogPath = join(root, "CHANGELOG.md");
let changelog = readFileSync(changelogPath, "utf8");
const date = new Date().toISOString().slice(0, 10);

if (changelog.includes("## [Unreleased]")) {
  // Rename the Unreleased heading to the new version (carrying its entries with
  // it), and place a fresh, empty Unreleased section above it.
  changelog = changelog.replace(
    "## [Unreleased]",
    `## [Unreleased]\n\n## [${newVersion}] - ${date}`,
  );
} else {
  console.warn("No [Unreleased] section found in CHANGELOG.md; skipping section roll.");
}

if (repoUrl && /\[Unreleased\]:[^\n]*\n/.test(changelog)) {
  changelog = changelog.replace(
    /\[Unreleased\]:[^\n]*\n/,
    `[Unreleased]: ${repoUrl}/compare/v${newVersion}...HEAD\n` +
      `[${newVersion}]: ${repoUrl}/releases/tag/v${newVersion}\n`,
  );
}
writeFileSync(changelogPath, changelog);

console.log(`Bumped ${oldVersion} -> ${newVersion}`);
console.log("Updated: package.json, openclaw.plugin.json, src/version.ts, CHANGELOG.md");
console.log("");
console.log("Next steps:");
console.log(`  1. Edit CHANGELOG.md so the [${newVersion}] section describes the changes.`);
console.log("  2. npm run verify");
console.log(`  3. git commit -am "chore(release): v${newVersion}" && git push origin main`);
console.log("  The Release workflow will publish to npm and create the GitHub release.");
