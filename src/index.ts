import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config";
import { resolveProfile } from "./discovery";
import { insecurePublicHttpWarning, safeError } from "./security";
import type { GPUStackConfig, OpenCodeModel } from "./types";

export { loadConfig, normalizeBaseURL, validateConfig } from "./config";
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

export const GPUStackPlugin: Plugin = async () => ({
  config: async (input) => {
    let pluginConfig: GPUStackConfig;
    try {
      pluginConfig = await loadConfig();
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
        options: {
          baseURL: profile.baseURL,
          apiKey: process.env[profile.apiKeyEnv],
        },
        models: providerModels(result.value.models),
      };
    });
  },
});

export default GPUStackPlugin;
