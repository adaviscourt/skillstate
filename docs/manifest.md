# Manifest Reference

Skillstate reads project intent from `skillstate.toml`. Unless `--config` is supplied, discovery begins at the current directory, walks upward, and stops at the nearest Git root.

## Complete Schema

```toml
schema = 1

[install]
agents = ["opencode"]
mode = "symlink"

[[sources]]
source = "owner/repo"
ref = "main"
skills = ["review", "test"]
```

### Top Level

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schema` | integer | Yes | Manifest schema; currently `1` |
| `install` | table | Yes | Shared installation defaults |
| `sources` | array of tables | No | Zero or more desired skill sources |

Unknown keys fail validation. This catches misspellings before installation.

### Install

| Key | Type | Values |
| --- | --- | --- |
| `agents` | string array | Non-empty upstream agent IDs |
| `mode` | string | `symlink` or `copy` |

Agent IDs are passed to `skills`. Skillstate reads the pinned backend's generated agent table at runtime instead of maintaining a destination map. Use command-line `--agent` and `--mode` overrides for local needs without changing shared configuration. Mode is an installation default; current upstream state cannot prove the mode of an already-present skill.

### Sources

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `source` | string | Yes | A tested upstream repository shorthand, URL, subpath, or local path |
| `ref` | string | No | Branch or tag, converted to `source#ref` |
| `skills` | string array or `"*"` | Yes | Explicit names or every skill discovered by upstream |

Duplicate source/ref/skill combinations are errors. Explicit IDs must be lowercase kebab-case and are unique across sources. This avoids backend normalization collisions. Explicit skill names are sorted when lifecycle commands update an entry.

## Source Formats

Skillstate delegates discovery and installation to `skills`. Reconciliation is tested for these formats:

```toml
# GitHub shorthand
source = "vercel-labs/agent-skills"

# Repository subpath
source = "anthropics/skills/skills/pdf"

# Full Git URL
source = "https://git.example.com/acme/skills.git"

# SSH
source = "git@github.com:acme/private-skills.git"

# Project-local path
source = "./skills/internal-review"
```

GitHub and GitLab tree URLs are supported. Exotic upstream aliases or ambiguous shorthand may be rejected rather than risk permanent drift.

Keep refs separate in TOML:

```toml
source = "owner/repo"
ref = "release-2026"
```

`skillstate add owner/repo#release-2026 --skill review` is accepted for convenience and is written as separate `source` and `ref` fields.

## Local Paths

Relative paths resolve from the manifest directory, never from the invoking process directory. Paths must exist. Lexical paths and resolved symlink targets escaping the Git root are rejected. Local sources cannot declare Git refs.

Upstream lock entries record local sources as absolute paths. Skillstate matches a committed relative local declaration by repository-relative suffix so relocated and teammate checkouts can restore from their own local path; the backend may rewrite its absolute lock source during sync.

## Wildcards

```toml
[[sources]]
source = "owner/repo"
skills = "*"
```

On a fresh sync, `"*"` asks upstream to discover and install every skill from that source. Offline checks cannot know whether a remote repository later added another skill. Once at least one matching lock entry exists, `check` reports a note rather than remote drift.

Schema 1 permits only one source when it uses `"*"`. Replace the wildcard with explicit names before adding another source.

Wildcard discovery may encounter legacy noncanonical backend names. Skillstate reports those lock entries but will not pass them to lifecycle or prune argv; replace the wildcard with explicit canonical IDs for full lifecycle management.

Single-skill removal from a wildcard is intentionally refused because editing `"*"` cannot express “everything except this name.” Replace the wildcard with explicit names first.

## Formatting Preservation

`add` and `remove` do not serialize and rewrite the complete document. They modify only the matching `skills` assignment, append one source block, or remove one now-empty source block. Inline comments on edited assignments and unrelated formatting survive. The complete candidate document is validated before backend mutation and before each atomic rename.
