See [AGENTS.md](./AGENTS.md) for full instructions on working in this repository
(setup, invariants, versioning, and the automated release process).

Quick reminders:

- Install with `npm install --ignore-scripts`; run `npm run verify` before committing.
- Never hardcode vault/item/field names; never log secret values.
- Change the version only via `npm run release:prepare -- <x.y.z>` (keeps
  `package.json`, `openclaw.plugin.json`, and `src/version.ts` in sync).
- Releases publish automatically when a version bump is pushed to `main`.
