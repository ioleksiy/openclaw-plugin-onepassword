# Contributing

Thanks for your interest in improving `openclaw-plugin-onepassword`! Contributions of all kinds — bug reports, docs, and code — are welcome.

## Development setup

Requires Node.js 20+ (the OpenClaw Gateway itself requires 22.22.3+; this repo builds and tests on both 20 and 22).

```bash
git clone https://github.com/ioleksiy/openclaw-plugin-onepassword.git
cd openclaw-plugin-onepassword
npm install --ignore-scripts
```

> `--ignore-scripts` is required: the `openclaw` dev dependency runs a Node-version preinstall check that can fail on unsupported Node versions. The plugin only needs its type definitions, so skipping lifecycle scripts is safe here.

## Everyday commands

| Command                                   | What it does                                          |
| ----------------------------------------- | ----------------------------------------------------- |
| `npm run build`                           | Compile `src/` to `dist/` with `tsc`.                 |
| `npm run typecheck`                       | Type-check everything (src + tests) without emitting. |
| `npm run lint`                            | ESLint (flat config), zero warnings allowed.          |
| `npm run format` / `npm run format:check` | Prettier write / check.                               |
| `npm test`                                | Run the Vitest suite.                                 |
| `npm run test:coverage`                   | Run tests with coverage.                              |

Please make sure `typecheck`, `lint`, `format:check`, and `test` all pass before opening a PR (CI runs the same checks).

## Guidelines

- **Keep it configuration-driven.** Never hardcode vault names, item paths, or field names.
- **Never log secret values.** Redact concealed fields and route errors so credential material cannot leak to stdout/logs.
- **Add tests** for new behavior. Unit tests must not make real network calls — mock the `OnePasswordClient`.
- Match the existing code style (Prettier + the ESLint config enforce most of it).

## Commit messages

Conventional Commits are appreciated but not required (e.g. `feat:`, `fix:`, `docs:`).

## Releasing

Releases are **automated on push to `main`**. The **Release** workflow builds,
tests, and publishes to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements), then tags
`vX.Y.Z` and creates a GitHub release — but **only when `package.json`'s version
is not already published on npm**. Ordinary commits publish nothing.

One-time setup: add an `NPM_TOKEN` repository secret (an npm **automation**
token) under **Settings → Secrets and variables → Actions**.

To cut a release (maintainers):

1. Bump the version (updates `package.json`, `openclaw.plugin.json`,
   `src/version.ts`, and rolls `CHANGELOG.md`):
   ```bash
   npm run release:prepare -- <x.y.z>
   ```
2. Edit `CHANGELOG.md` so the new section describes the changes.
3. Verify: `npm run verify`.
4. Commit and push to `main`:
   ```bash
   git commit -am "chore(release): v<x.y.z>"
   git push origin main
   ```

The workflow handles publish, tag, and GitHub release. **Do not** create the tag
yourself or `npm publish` locally. A published version can't be overwritten — if
a release breaks, fix forward with a new patch version. See [AGENTS.md](./AGENTS.md)
for the semver policy.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
