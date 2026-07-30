# Command Reference

Run `skillstate <command> --help` for concise usage and examples at the terminal.

## Global Options

| Option | Description |
| --- | --- |
| `--config <path>` | Resolve another manifest from the current directory |
| `--json` | Emit a versioned JSON document to stdout |
| `--verbose` | Include planner reasons and exact backend argv |
| `--agent <name>` | Override configured target on commands that install or inspect targets |
| `--mode <mode>` | Override `symlink` or `copy` for new/reconciled installs |
| `--copy` | Shortcut for `--mode copy` |
| `--yes` | Skip destructive prune confirmation on `sync` |

## `init`

```bash
skillstate init --agent opencode
skillstate init --agent claude-code --agent codex --copy
```

Creates an empty `skillstate.toml` at the nearest Git root. In an interactive terminal with no `--agent`, prompts for comma-separated IDs. Non-interactive use requires an explicit target. Refuses to operate outside Git or overwrite an existing file.

## `sync`

```bash
skillstate sync
skillstate sync --dry-run --verbose
skillstate sync --agent opencode --copy
```

Builds one deterministic plan from manifest, lock, and per-agent observed state. Missing/mismatched skills are grouped by source and installed using the bundled, tested `skills` CLI. Locked skills absent from generated directories become explicit restore actions. Every subprocess runs non-interactively with explicit agents.

`--dry-run` never invokes a mutating backend command.

### Pruning

```bash
skillstate sync --prune --dry-run
skillstate sync --prune --yes
```

Without `--prune`, synchronization never removes entries. With it, every lock entry not represented by an explicit declaration or matching wildcard source becomes an all-project-agent removal. Human sessions prompt; non-interactive sessions must pass `--yes`.

The upstream lock has no Skillstate ownership marker. Review prune plans because a lock entry may have been installed manually.

## `check`

```bash
skillstate check
skillstate check --json
```

Validates TOML, lock schema, declared names, sources, explicit refs, and exact configured-agent presence. It only reads backend-owned project paths, never mutates files, and never accesses the network. Returns exit `3` for drift.

Checks are intentionally limited by upstream metadata: they do not prove exact commits, install mode, or local byte integrity.

## `list`

```bash
skillstate list
skillstate list --json
```

Displays each desired skill and whether matching source/ref state is locked and present in every target agent. Also reports conflicting or undeclared lock entries.

## `add`

```bash
skillstate add owner/repo --skill review
skillstate add owner/repo --ref v1 --skill review --skill test
skillstate add ./skills/internal-review --skill internal-review
skillstate add owner/repo --skill '*'
```

`--skill` is repeatable. A selection is required so shared intent never depends on an interactive choice. The backend installation runs first; after success, Skillstate atomically updates or appends the source declaration. `--dry-run` reports argv and manifest intent without changing either installation or manifest.

## `remove`

```bash
skillstate remove review
skillstate remove review --dry-run
```

Removes the shared project skill from all project agents, verifies every backend-owned target path, then edits the explicit declaration. Refuses agent overrides, ambiguous declarations, and wildcard-only selections.

## `update`

```bash
skillstate update
skillstate update review test
```

Reinstalls selected declarations from their manifest source and verifies resulting state. Named updates must be explicitly declared. With no names, Skillstate refreshes every explicit declaration or rediscovers the sole wildcard source; unmanaged lock entries remain untouched.

Alternate manifests share the Git-root `skills-lock.json` and generated project directories. For safety, `sync --prune` refuses `--config`; prune only from the root manifest.

Because mutable branches can move whenever upstream fetches them, `update` expresses intent but cannot turn a branch into an immutable pin.

## JSON Contract

Machine output always contains `"schema": 1`, a command/status field, and command-specific data. Plan commands include normalized actions, summaries, destructive markers, and raw backend argument arrays.

```json
{
  "schema": 1,
  "command": "check",
  "status": "drift",
  "actions": [
    {
      "kind": "install",
      "source": "owner/repo",
      "skills": ["review"],
      "destructive": false
    }
  ],
  "summary": {
    "changes": 1,
    "installs": 1,
    "restores": 0,
    "removals": 0,
    "warnings": 0
  }
}
```

JSON data goes to stdout. Verbose backend diagnostics go to stderr.

## Exit Codes

| Code | Meaning |
| ---: | --- |
| `0` | Success / no drift |
| `1` | Command or backend operation failure |
| `2` | Invalid manifest or configuration |
| `3` | Drift detected by `check` |
| `4` | Backend package or lock schema incompatibility |
