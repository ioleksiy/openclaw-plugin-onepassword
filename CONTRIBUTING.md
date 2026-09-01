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

Maintainers only:

1. Update the version in **all three** places (a unit test enforces they match):
   - `package.json`
   - `openclaw.plugin.json`
   - `src/version.ts`
2. Update `CHANGELOG.md` (move items from _Unreleased_ into the new version).
3. Commit, then tag: `git tag vX.Y.Z && git push --tags`.
4. The **Release** GitHub Action builds, tests, and publishes to npm with
   [provenance](https://docs.npmjs.com/generating-provenance-statements). It
   requires an `NPM_TOKEN` repository secret (an npm automation token).

To publish manually instead:

```bash
npm publish --provenance --access public
```

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
