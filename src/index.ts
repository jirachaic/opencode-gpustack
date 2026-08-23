import type { Plugin } from "@opencode-ai/plugin";
import { loadPluginConfig } from "./config";
import { resolveProfile } from "./discovery";
import { insecurePublicHttpWarning, safeError } from "./security";
import type { GPUStackConfig, OpenCodeModel } from "./types";

export {
  loadConfig,
  loadPluginConfig,
  normalizeBaseURL,
  validateConfig,
} from "./config";
export { discover, modelsURL, resolveProfile } from "./discovery";
export * from "./types";

type MutableConfig = {
  provider?: Record<string, unknown>;
};

function providerModels(
  models: Array<{ id: string; config: OpenCodeModel }>,
): Record<string, OpenCodeModel> {
  return Object.fromEntries(models.map((model) => [model.id, model.config]));
}

function providerOptions(
  baseURL: string,
  apiKey: string,
): Record<string, unknown> {
  const options = { baseURL, apiKey };
  Object.defineProperty(options, "toJSON", {
    // Bun 1.3 only honors an enumerable toJSON property. The provider ignores
    // this extra option, while OpenCode's debug serialization stays redacted.
    enumerable: true,
    value: () => ({ baseURL, apiKey: "[REDACTED]" }),
  });
  return options;
}

export const GPUStackPlugin: Plugin = async () => ({
  config: async (input) => {
    let pluginConfig: GPUStackConfig;
    try {
      const loaded = await loadPluginConfig();
      pluginConfig = loaded.config;
      for (const warning of loaded.warnings) {
        console.warn(`[opencode-gpustack] ${warning}; profile skipped`);
      }
    } catch (error) {
      console.warn(`[opencode-gpustack] ${safeError(error)}`);
      return;
    }
    const config = input as MutableConfig;
    if (!config.provider) config.provider = {};
    const providers = config.provider;
    const profiles = pluginConfig.profiles.filter(
      (profile) => profile.enabled !== false,
    );
    const results = await Promise.allSettled(
      profiles.map((profile) =>
        resolveProfile(profile, {
          timeoutMs: pluginConfig.discovery?.timeoutMs ?? 5_000,
        }),
      ),
    );
    results.forEach((result, index) => {
      const profile = profiles[index];
      const providerID = `gpustack-${profile.id}`;
      if (providerID in providers) {
        console.warn(
          `[opencode-gpustack] Provider ${providerID} already exists; profile skipped`,
        );
        return;
      }
      const transportWarning = insecurePublicHttpWarning(profile.baseURL);
      if (transportWarning)
        console.warn(`[opencode-gpustack] ${profile.id}: ${transportWarning}`);
      if (result.status === "rejected") {
        console.warn(
          `[opencode-gpustack] ${profile.id}: ${safeError(result.reason)}`,
        );
        return;
      }
      if (result.value.warning)
        console.warn(
          `[opencode-gpustack] ${profile.id}: ${result.value.warning}`,
        );
      providers[providerID] = {
        npm: "@ai-sdk/openai-compatible",
        name: profile.name,
        options: providerOptions(
          profile.baseURL,
          process.env[profile.apiKeyEnv] as string,
        ),
        models: providerModels(result.value.models),
      };
    });
  },
});

export default GPUStackPlugin;
