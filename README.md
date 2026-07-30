# Skillstate

[![CI](https://github.com/adaviscourt/skillstate/actions/workflows/ci.yml/badge.svg)](https://github.com/adaviscourt/skillstate/actions/workflows/ci.yml)
[![CodeQL](https://github.com/adaviscourt/skillstate/actions/workflows/codeql.yml/badge.svg)](https://github.com/adaviscourt/skillstate/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Declarative project skill environments, powered by [skills.sh](https://skills.sh).**

Skillstate gives AI agent skills a package-manager workflow. Declare project intent in a small TOML file, preview a deterministic plan, synchronize through the established [`skills`](https://github.com/vercel-labs/skills) CLI, and detect drift in CI.

```text
skillstate.toml  ->  Skillstate planner  ->  skills CLI  ->  agent skill directories
                              |
                              +-> skills-lock.json
```

Skillstate does not replace the skills ecosystem. It adds the human-owned manifest and safe reconciliation layer around it.

## Quick Start

Requirements: Node.js 22.20 or newer and Git.

```bash
# Create a manifest at the Git root
npx skillstate init --agent opencode

# Preview, then add the first project skill
npx skillstate add vercel-labs/agent-skills --skill web-design-guidelines --dry-run
npx skillstate add vercel-labs/agent-skills --skill web-design-guidelines

# Confirm the project is converged
npx skillstate sync --dry-run

# Install declared skills non-interactively
npx skillstate sync
```

For repeatable CI and team usage, install Skillstate in the project:

```bash
npm install --save-dev skillstate
npx skillstate check
```

`skillstate check` never accesses the network or changes files. It exits `3` when declared state is not covered by `skills-lock.json` or is absent from a configured agent.

## Usage Examples

Start a repository with shared Claude Code and OpenCode skills:

```bash
skillstate init --agent claude-code --agent opencode
skillstate add vercel-labs/agent-skills --skill react-best-practices
skillstate sync
```

Preview exactly what Skillstate would change before touching generated skill directories:

```bash
skillstate sync --dry-run --verbose
```

Install a project-local skill that lives in the same repository:

```bash
skillstate add ./skills/internal-review --skill internal-review
```

Refresh one declared skill from its source:

```bash
skillstate update react-best-practices
```

Use CI to catch drift after someone edits the manifest or generated skills:

```bash
npx skillstate check
```

## Manifest

Default filename: `skillstate.toml` at the Git repository root.

```toml
schema = 1

[install]
agents = ["claude-code", "opencode"]
mode = "symlink"

[[sources]]
source = "vercel-labs/agent-skills"
ref = "main"
skills = [
  "react-best-practices",
  "web-design-guidelines",
]

[[sources]]
source = "anthropics/skills/skills/pdf"
skills = ["pdf"]

[[sources]]
source = "./skills/internal-review"
skills = ["internal-review"]
```

### Rules

- `schema` is required and must equal `1`.
- `install.agents` contains one or more agent IDs accepted by `skills`.
- `install.mode` is `symlink` or `copy`.
- Skill IDs use canonical lowercase kebab-case so backend directory identity is unambiguous.
- A manifest may have zero dependencies; each source selects a non-empty skill list or `"*"`.
- A wildcard source cannot be combined with another source in schema 1 because ownership overlap is unknowable offline.
- `ref` is optional and maps to upstream `source#ref` syntax.
- Unknown keys and duplicate source/ref/skill combinations are errors.
- Relative local sources resolve from the manifest directory.
- Local sources outside the Git repository are rejected.
- Agent compatibility and destination paths remain owned by `skills`; Skillstate has no agent directory map.

See [Manifest Reference](docs/manifest.md) for source formats, validation, and wildcard behavior.

## Commands

| Command | Purpose | Mutates files? |
| --- | --- | --- |
| `skillstate init` | Create a documented starter manifest | Manifest only |
| `skillstate sync` | Install or restore missing/mismatched declarations | Yes |
| `skillstate sync --dry-run` | Print deterministic plan (`--verbose` adds argv) | No |
| `skillstate sync --prune` | Remove undeclared lock entries after confirmation | Yes, destructive |
| `skillstate check` | Validate manifest-to-lock coverage for CI | No |
| `skillstate list` | Show desired, locked, and unmanaged state | No |
| `skillstate add <source> --skill <name>` | Install, then update manifest in place | Yes |
| `skillstate remove <name>` | Uninstall from project agents, then update manifest | Yes |
| `skillstate update [name...]` | Intentionally refresh project skills | Yes |

Invocation options (availability is command-specific):

```text
--agent <name>       Override targets; repeat for multiple agents
--mode <mode>        Override symlink or copy for this invocation
--copy               Shortcut for --mode copy
--config <path>      Use another manifest
--json               Emit versioned machine-readable output
--yes                Skip sync prune confirmation
--verbose            Show reasons and exact backend commands
```

Every command includes examples and behavioral notes:

```bash
skillstate --help
skillstate sync --help
skillstate add --help
```

Full details: [Command Reference](docs/commands.md).

## Everyday Workflows

### Add a skill

```bash
skillstate add vercel-labs/agent-skills --skill web-design-guidelines
```

Skillstate installs first. Only after the backend succeeds does it atomically edit the manifest. Existing comments and unrelated formatting remain untouched.

Select multiple skills by repeating `--skill`:

```bash
skillstate add owner/repo --ref v1 --skill review --skill test
```

### Preview and synchronize

```bash
skillstate sync --dry-run --verbose
skillstate sync
```

Normal synchronization is additive and corrective. It never removes lock entries that are absent from the manifest.

### Detect drift in CI

```bash
skillstate check --json
```

JSON goes to stdout. Human diagnostics and backend details go to stderr, keeping automation output parseable.

### Prune intentionally

```bash
skillstate sync --prune --dry-run
skillstate sync --prune
```

Pruning treats every backend lock entry not covered by the manifest as removable across project agents. Because the upstream lock does not record which tool created an entry, always review the plan. Non-interactive pruning requires `--yes`.

## Lock Semantics

`skills-lock.json` belongs to the upstream `skills` CLI. Skillstate reads it but never hand-edits or reserializes it.

Current upstream lock data records source, ref, skill path, and a computed content hash. Restore and update behavior can fetch a mutable ref again; the previous hash is not an immutable content pin. Therefore:

- `check` verifies manifest-to-lock coverage, source/ref agreement, and configured-agent presence.
- `sync` restores desired declarations using current upstream behavior.
- Wildcard checks can only observe skills already present in the lock.
- Backend hashes are provenance/update metadata, not a portable installed-folder integrity contract; Skillstate does not claim local byte-drift detection.
- Skillstate does **not** promise byte-for-byte frozen installs or exact commit pinning.

## What to Commit

Commit `skillstate.toml` and backend-owned `skills-lock.json`. Generated agent directories may be ignored if your team wants `skillstate sync` to restore them after clone; committed copies/symlinks also work. Never hand-edit `skills-lock.json`.

A clean clone with a committed lock and no generated skill directories is supported: `skillstate sync` resolves exact target paths from the pinned backend's generated agent table and restores missing declarations.

Read [Architecture](docs/architecture.md#state-and-reproducibility) for the precise trust boundary.

## Exit Codes

| Code | Meaning |
| ---: | --- |
| `0` | Success; no drift |
| `1` | Command, installation, or backend operation failed |
| `2` | Invalid or missing manifest/configuration |
| `3` | Drift detected by `check` |
| `4` | Unsupported backend or lock compatibility |

## Security

Agent skills are instructions and assets exposed to privileged AI tools. Review sources before installation just as you would review code dependencies.

Skillstate never evaluates input through a shell. Backend commands use argument arrays and `shell: false`; option-like skill names are rejected; local paths and symlink targets cannot escape the project; destructive pruning requires explicit confirmation. Skillstate itself does not execute code from a skill, but an agent may follow installed instructions or access referenced assets.

See [Security Policy](SECURITY.md) for reporting and threat-model details.

## Troubleshooting

### No manifest found

Run `skillstate init --agent <name>` from anywhere inside a Git repository. Discovery walks upward and stops at the nearest Git root.

### Unsupported agent

Use the exact agent ID accepted by `skills`, such as `claude-code`, `codex`, or `opencode`. Skillstate deliberately delegates the full agent list and validation to the backend.

### Windows symlink permissions

Use `--copy` or set `mode = "copy"` when Developer Mode or symlink privileges are unavailable.

### Private repository authentication

Skillstate preserves upstream Git authentication. Configure Git, `gh`, or SSH credentials before synchronization; credentials are never collected or printed by Skillstate.

### Why check cannot detect a newly added wildcard skill

`check` is offline. For `skills = "*"`, it can inspect only existing lock entries. Run `skillstate update` when you want upstream discovery.

## Project

- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/architecture.md)
- [Command Reference](docs/commands.md)
- [Manifest Reference](docs/manifest.md)
- [Changelog](CHANGELOG.md)
- [Security](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

Skillstate is available under the [MIT License](LICENSE).
