# Project Context

`opencode-gpustack` is an OpenCode plugin and CLI that projects GPUStack's currently running, accessible LLM routes into OpenCode custom providers.

## Boundaries

- GPUStack remains the source of truth for deployments, access control, and live model IDs.
- OpenCode remains the coding-agent UI and inference client.
- Discovery reads `GET /v1/models?categories=llm&with_meta=true` at startup.
- Each configured GPUStack profile maps to `gpustack-<profile-id>`.
- Cache snapshots contain discovery data only. Configuration overrides and API keys must never be persisted in them.
- Cache fallback is allowed only for network, timeout, and server failures—not authentication or malformed-response failures.

## Compatibility

The minimum supported OpenCode release is 1.18.21. Custom providers must be populated through the plugin `config` hook because provider-model hooks do not discover unknown custom provider IDs in that release.
