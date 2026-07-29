# Security Policy

## Supported Versions

Until the first stable release, only the latest published pre-1.0 release receives security fixes. After `1.0.0`, the latest minor release will be supported.

## Reporting a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/adaviscourt/skillstate/security/advisories/new). Include affected versions, reproduction steps, impact, and any proposed mitigation.

Please do not disclose the issue publicly before a fix and coordinated release are available. Expect an initial response within seven days.

## Threat Model

Skillstate treats manifests, lockfiles, source names, refs, paths, and backend output as untrusted.

Security properties:

- subprocesses receive argument arrays with `shell: false`;
- option-like lock keys and skill names are rejected before argv construction;
- local manifest sources and symlink targets cannot resolve outside the repository;
- skill names cannot contain traversal separators;
- unknown manifest keys fail closed;
- backend lock schema is checked before use;
- destructive prune requires confirmation or explicit `--yes`;
- non-interactive destructive use fails instead of waiting for input;
- credentials remain under Git/backend control and are not logged by Skillstate.

Important limitation: agent skills are instructions and assets consumed by privileged AI agents. Skillstate does not execute skill code during installation, but installed instructions can influence an agent and reference tools or resources. Review source trust, changes, and refs before syncing.

Exact content integrity is not guaranteed by current upstream lock behavior. Skillstate verifies source/ref coverage and exact target presence, not local bytes. See [State and Reproducibility](docs/architecture.md#state-and-reproducibility).

Public repository settings should keep GitHub secret scanning and push protection enabled. CI additionally runs dependency review, CodeQL, and production dependency audit checks.
