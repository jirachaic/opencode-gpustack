import { readCache, writeCache } from "./cache";
import { applyDiscoveredModelOverride, parseModels } from "./models";
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
    readonly kind:
      | "configuration"
      | "authentication"
      | "client"
      | "server"
      | "network"
      | "timeout"
      | "contract",
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
      "configuration",
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
    if (!response.ok) {
      const kind =
        response.status === 401 || response.status === 403
          ? "authentication"
          : response.status >= 500 ||
              response.status === 408 ||
              response.status === 429
            ? "server"
            : "client";
      throw new DiscoveryError(
        `GPUStack returned HTTP ${response.status}`,
        kind,
        response.status,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
      return parseModels(payload, profile);
    } catch (error) {
      throw new DiscoveryError(
        `GPUStack returned an invalid model payload: ${safeError(error)}`,
        "contract",
      );
    }
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    if ((error as Error).name === "AbortError")
      throw new DiscoveryError(
        `GPUStack discovery timed out after ${options.timeoutMs}ms`,
        "timeout",
      );
    throw new DiscoveryError(
      `GPUStack discovery failed: ${safeError(error)}`,
      "network",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveProfile(
  profile: GPUStackProfile,
  options: DiscoveryOptions,
): Promise<ResolvedProfile> {
  try {
    const profileWithoutOverrides = { ...profile, modelOverrides: {} };
    const discovered = await discover(profileWithoutOverrides, options);
    const snapshot = await writeCache(profile, discovered, options.env);
    const models = applyOverrides(discovered, profile);
    return { profile, models, source: "live", fetchedAt: snapshot.fetchedAt };
  } catch (error) {
    if (
      !(error instanceof DiscoveryError) ||
      !["network", "timeout", "server"].includes(error.kind)
    )
      throw error;
    const snapshot = await readCache(profile, options.env);
    if (!snapshot) throw error;
    return {
      profile,
      models: applyOverrides(snapshot.models, profile),
      source: "cache",
      fetchedAt: snapshot.fetchedAt,
      warning: `${safeError(error)}; using cached models from ${snapshot.fetchedAt}`,
    };
  }
}

function applyOverrides(
  models: DiscoveredModel[],
  profile: GPUStackProfile,
): DiscoveredModel[] {
  return models.map((model) => {
    return applyDiscoveredModelOverride(
      model,
      profile.modelOverrides?.[model.id],
    );
  });
}
