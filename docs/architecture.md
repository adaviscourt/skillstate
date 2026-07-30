# Architecture

Skillstate is a thin desired-state frontend. It owns declaration, validation, planning, output, and safety policy. [`skills`](https://github.com/vercel-labs/skills) owns source parsing, discovery, Git operations, agent compatibility, destination paths, and lock writes.

```text
DesiredState + InstalledState + invocation overrides -> pure Plan
                                                        |
                                                        v
                                             backend argv adapter
                                                        |
                                                        v
                                                   skills CLI
```

## Modules

| Module | Responsibility |
| --- | --- |
| `src/config.ts` | Git-bounded discovery, TOML parsing, strict validation, normalization |
| `src/model.ts` | Desired, installed, action, and exit-code types |
| `src/lock.ts` | Read-only adapter for project `skills-lock.json` version 1 |
| `src/planner.ts` | Pure desired-versus-installed reconciliation |
| `src/backend.ts` | Tested-version resolution, argv construction, shell-free subprocesses |
| `src/manifest-editor.ts` | Narrow, comment-preserving, atomic lifecycle edits |
| `src/output.ts` | Human plans and versioned JSON documents |
| `src/commands/` | Command orchestration around the shared plan/backend boundaries |

Commands never construct subprocess strings. Reconciliation uses planner-emitted argument arrays; lifecycle commands use the same pure argv builders. One adapter performs every spawn with `shell: false`.

## Planning

Planner inputs are normalized and filesystem-independent:

```text
DesiredState + InstalledState + InvocationOverrides -> Plan
```

Actions include install/restore/remove/no-op/warning kind, source/ref, selected names, agents, mode, reason, destructive status, and exact backend argv. The same structure powers dry runs, execution, human output, JSON, and unit tests.

Normal planning emits installs and no-ops. Prune mode additionally emits explicit destructive removals. No action is hidden from a dry-run plan.

## Backend Compatibility

Skillstate resolves the `skills` package installed beside itself, not a PATH binary and never unpinned `npx skills`. Current compatibility is exactly `1.5.20` with Node.js `>=22.20.0`.

Runtime resolution verifies the backend version before mutation. The package lock fixes the tested dependency in development and CI. Upstream upgrades should arrive as tested dependency PRs because the CLI and experimental lock contract can change within minor releases.

## State and Reproducibility

Project `skills-lock.json` is backend-owned state. Skillstate:

- reads supported fields for planning;
- rejects unsupported schema versions;
- never writes, patches, or reformats the file;
- delegates lock changes to `skills add`, `skills remove`, and `skills update`.

Upstream version 1 lock entries contain source, optional ref, optional skill path, and a computed hash. They do not record general target agents, install mode, or a guaranteed immutable commit. Skillstate reads project paths from the pinned backend's generated agent table, then inspects each exact target directory. This allows clean-clone restoration and missing-placement detection without owning an agent path map. Current restore/update behavior can fetch a mutable ref and does not use the previous computed hash as a strict replacement guard.

Consequently, “ready” means declared source/name/ref coverage exists and the skill is present in each exact configured-agent directory. Backend hashes are not treated as a portable installed-folder integrity contract. “Ready” does not mean cryptographic reproducibility or local byte integrity.

## Ownership

Normal sync is deliberately non-destructive. Unrelated backend entries can be manual or tool-managed and remain untouched.

Explicit prune mode interprets all undeclared lock entries as removal candidates and requires review/confirmation. This is opt-in because lock version 1 has no ownership field.

## Manifest Editing

Lifecycle commands avoid whole-file TOML serialization. The editor identifies `[[sources]]` block boundaries, parses each block for identity, and changes only the `skills` assignment or block membership. New content is written to a same-directory exclusive temporary file, retains mode bits, and is atomically renamed.

## Security Boundaries

- Manifest strings never enter a shell.
- Source, ref, agent, skill, and local-path values are validated before argv construction.
- Local paths cannot escape the repository.
- Skillstate never collects credentials.
- Backend auth and protocol policy remain upstream behavior.
- Destructive pruning fails rather than prompting indefinitely in non-TTY environments.
- Installed skills are untrusted instructions even though Skillstate does not execute their code.

## Testing

Default tests are deterministic and network-free. They cover schema validation, Git-root boundaries, local/remote normalization, lock compatibility, planner action generation, raw argv ordering, exit mapping, JSON status, and formatting preservation.

Package smoke tests build, pack, install into a clean temporary consumer, and invoke the npm binary. Network E2E is isolated behind `npm run test:e2e` and scheduled/manual CI.
