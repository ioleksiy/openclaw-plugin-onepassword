# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-01

### Added

- Initial release.
- **In-process store sync**: resolve `op://` references from 1Password using
  `@1password/sdk` and write them into the OpenClaw shared store via the
  `secrets.store.set` Gateway RPC, bypassing the exec secret sandbox introduced
  in OpenClaw v2026.8.1. Runs at Gateway startup and on demand.
- **`onepassword.sync`** and **`onepassword.status`** gateway methods.
- **Optional agent tools**: `1password_list_vaults`, `1password_list_items`,
  `1password_get_item`, `1password_read_field`, and (opt-in) `1password_create_item`,
  `1password_update_item`, `1password_delete_item`. Concealed fields are redacted
  by default.
- **Optional exec resolver mode** via `secretProviderIntegrations` for setups
  that allowlist 1Password egress and prefer `op://` ids on `SecretRef`s.

[Unreleased]: https://github.com/ioleksiy/openclaw-plugin-onepassword/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ioleksiy/openclaw-plugin-onepassword/releases/tag/v0.1.0
