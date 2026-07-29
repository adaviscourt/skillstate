# Contributing

Thanks for improving Skillstate. Small, focused changes with tests and documentation are easiest to review.

## Requirements

- Node.js 22.20 or newer
- npm 11 (the version in `packageManager` is recommended)
- Git

## Setup

```bash
git clone https://github.com/adaviscourt/skillstate.git
cd skillstate
npm install
npm run check
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev -- --help` | Run TypeScript CLI directly |
| `npm run build` | Compile ESM output to `dist/` |
| `npm test` | Run deterministic tests |
| `npm run test:watch` | Run tests during development |
| `npm run test:coverage` | Generate coverage report |
| `npm run quality` | Check formatting and lint |
| `npm run format` | Apply repository formatting |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm run package:check` | Validate and smoke-test npm tarball |
| `npm run check` | Run all local quality gates |
| `npm run test:e2e` | Run opt-in public-network install test |

## Design Principles

- Keep Skillstate a thin frontend; do not copy upstream source parsing or agent paths.
- Prefer pure planning and one subprocess boundary.
- Never invoke manifest-controlled input through a shell.
- Preserve unrelated TOML formatting and comments.
- Do not claim reproducibility that upstream metadata cannot prove.
- Make destructive behavior explicit, previewable, and confirmable.
- Keep human and JSON output useful without backend-output parsing.

## Changes

1. Open an issue for substantial behavior or schema changes.
2. Add focused tests before or with implementation.
3. Update CLI help and repository docs for user-visible behavior.
4. Run `npm run check`.
5. Use a concise [Conventional Commit](https://www.conventionalcommits.org/) subject.

Network-dependent tests do not run in the default suite. Avoid adding network calls to unit or integration tests.

## Backend Upgrades

`skills` is a CLI contract, not a stable library API. Any dependency upgrade must verify:

- Node engine and binary resolution;
- `add`, `remove`, and `update` argv behavior;
- non-interactive and agent/copy flags;
- project lock version and fields;
- source/ref normalization;
- Windows and POSIX behavior;
- package and network E2E tests.

## Reporting Security Issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
