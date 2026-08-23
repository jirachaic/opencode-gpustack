import { readCache, writeCache } from "./cache";
import { parseModels } from "./models";
import { safeError } from "./security";
import type {
  DiscoveredModel,
  GPUStackProfile,
  ResolvedProfile,
} from "./types";

export type DiscoveryOptions = {
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
};

export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}

export function modelsURL(profile: GPUStackProfile): string {
  const url = new URL(`${profile.baseURL}/models`);
  url.searchParams.set("categories", "llm");
  url.searchParams.set("with_meta", "true");
  return url.toString();
}

export async function discover(
  profile: GPUStackProfile,
  options: DiscoveryOptions,
): Promise<DiscoveredModel[]> {
  const env = options.env ?? process.env;
  const apiKey = env[profile.apiKeyEnv];
  if (!apiKey)
    throw new DiscoveryError(
      `Missing API key environment variable: ${profile.apiKeyEnv}`,
    );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(
      modelsURL(profile),
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new DiscoveryError(
        `GPUStack returned HTTP ${response.status}`,
        response.status,
      );
    return parseModels(await response.json(), profile);
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    if ((error as Error).name === "AbortError")
      throw new DiscoveryError(
        `GPUStack discovery timed out after ${options.timeoutMs}ms`,
      );
    throw new DiscoveryError(`GPUStack discovery failed: ${safeError(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveProfile(
  profile: GPUStackProfile,
  options: DiscoveryOptions,
): Promise<ResolvedProfile> {
  try {
    const models = await discover(profile, options);
    const snapshot = await writeCache(profile, models, options.env);
    return { profile, models, source: "live", fetchedAt: snapshot.fetchedAt };
  } catch (error) {
    const snapshot = await readCache(profile, options.env);
    if (!snapshot) throw error;
    return {
      profile,
      models: snapshot.models,
      source: "cache",
      fetchedAt: snapshot.fetchedAt,
      warning: `${safeError(error)}; using cached models from ${snapshot.fetchedAt}`,
    };
  }
}
