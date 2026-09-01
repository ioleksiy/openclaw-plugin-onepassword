# Security Policy

## Supported versions

The latest published `0.x` release receives security fixes. Until a `1.0`
release, older `0.x` versions are not maintained.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately using GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" under the repository's **Security** tab), or email the
maintainers listed in the repository metadata.

We aim to acknowledge reports within 5 business days and to provide a remediation
timeline after triage.

## Scope and handling notes

This plugin handles 1Password service account tokens and resolved secret values.
When reporting, please consider:

- **Never include real tokens or secret values** in reports; redact them.
- Relevant areas include: secret material leaking to logs/stdout/errors, the
  exec resolver protocol, store writes, and the agent tools' redaction behavior.

Because plugin code runs inside the OpenClaw Gateway process with full Gateway
privileges, treat any issue that could exfiltrate secrets or execute unintended
code as high severity.
