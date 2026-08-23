# opencode-gpustack

Automatically discover running GPUStack LLMs and expose them as OpenCode providers. The plugin supports multiple GPUStack deployments, model metadata, include/exclude filters, per-model overrides, and last-known-good cache fallback.

## Requirements

- OpenCode 1.18.21 or newer
- Bun 1.2 or newer
- A GPUStack API key with **Model Access → All models**

Only running LLM routes visible to the API key are imported. Embedding, reranking, image, and speech models are intentionally excluded from OpenCode's coding-model picker.

## Install

Install the OpenCode plugin and CLI from npm. OpenCode resolves plugin package
names through npm:

```bash
bun add -g opencode-gpustack
```

Add the plugin to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-gpustack"]
}
```

Create `~/.config/opencode/gpustack.json`:

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "bkk",
      "name": "GPUStack BKK",
      "baseURL": "https://gpustack.example.com/v1",
      "apiKeyEnv": "GPUSTACK_BKK_API_KEY",
      "enabled": true,
      "include": ["*"],
      "exclude": [],
      "modelOverrides": {}
    }
  ],
  "discovery": { "timeoutMs": 5000 }
}
```

Export the credential and start OpenCode:

```bash
export GPUSTACK_BKK_API_KEY="your-api-key"
opencode
```

Or initialize one profile with the CLI:

```bash
bunx opencode-gpustack init \
  --id bkk \
  --name "GPUStack BKK" \
  --base-url https://gpustack.example.com/v1 \
  --api-key-env GPUSTACK_BKK_API_KEY
```

Run `/models` in OpenCode and select a model under `gpustack-bkk`.

The TypeScript library entrypoints are also published on JSR as
`@jirachaic/opencode-gpustack`:

```bash
bunx jsr add @jirachaic/opencode-gpustack
```

```ts
import GPUStackPlugin from "@jirachaic/opencode-gpustack";
```

The JSR package is for programmatic TypeScript imports. Use the npm package for
OpenCode plugin registration and the `opencode-gpustack` CLI.

## CLI

```text
opencode-gpustack discover [--profile ID] [--json]
opencode-gpustack sync [--profile ID]
opencode-gpustack doctor [--profile ID]
opencode-gpustack cache list
opencode-gpustack cache clear
```

`discover` reads GPUStack without modifying cache. `sync` refreshes cache and reports model changes. `doctor` checks configuration, credentials, transport, and connectivity.

## Model overrides

GPUStack metadata is mapped when available. Override it when a backend does not report accurate limits or capabilities:

```json
{
  "modelOverrides": {
    "qwen3-coder": {
      "name": "Qwen 3 Coder",
      "limit": { "context": 32768, "output": 4096 },
      "tool_call": true,
      "reasoning": true
    }
  }
}
```

OpenCode requires both `context` and `output` before it accepts a model limit block. If GPUStack reports only one value, the plugin preserves it in discovery/cache metadata and `doctor` warns; provide the missing value in `modelOverrides` to complete the pair.

Include and exclude entries are anchored glob patterns. Exclusions take precedence.

## Failure behavior and security

Discovery occurs when OpenCode starts. Each successful response is cached atomically in the platform cache directory. If GPUStack is unavailable, the plugin uses the matching cached snapshot and reports its timestamp. Cache files contain model metadata only—never API keys.

API keys are resolved from the named environment variable. Unencrypted HTTP is accepted for loopback, private-address, and Tailscale deployments; potentially public HTTP endpoints produce a warning.

Set `OPENCODE_GPUSTACK_CONFIG` to use a different configuration path. Standard `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` overrides are respected.

## Development

```bash
bun install
bun run check
bun run build
bun run test:jsr
bun pm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.
