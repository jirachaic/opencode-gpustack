# Agent Guide

Read [CONTEXT.md](CONTEXT.md) before changing runtime behavior.

## Workflow

- Create or pick a tracked item with `bun run progress --` before work. If the
  command is unavailable, report that explicitly rather than pretending the
  work was tracked.
- Use `ccc` for semantic code search and run `ccc index` after structural
  changes.
- Add tests with behavior changes. Before handoff, run `bun run check`,
  `bun run build`, and the relevant package or OpenCode integration smoke test.
- Keep changes focused, preserve unrelated worktree edits, and never commit
  credentials, generated caches, or captured authorization headers.

## Architecture Invariants

- GPUStack is the source of truth for deployed model routes and permissions.
- OpenCode remains the coding interface; this project only discovers and maps
  providers and models.
- Validate profiles independently so one bad profile cannot disable the others.
- Cache only raw discovery metadata. Never cache or log API keys or
  secret-bearing operator overrides.
- Preserve GPUStack route IDs exactly. Apply validated operator overrides only
  after discovery or cache loading.
- Restrict stale-cache fallback to connectivity, timeout, throttling, and server
  failures—not authentication or malformed responses.
- Keep npm and JSR package versions synchronized. npm is the canonical OpenCode
  plugin and CLI distribution; JSR exposes the TypeScript library entrypoints.

## Future-Proofing

- Put changeable values behind configuration or explicit constants.
- Preserve multi-profile and endpoint isolation; do not introduce global state
  that couples deployments.
- Record intentional deferrals in the project tracker rather than leaving
  undocumented technical debt.
