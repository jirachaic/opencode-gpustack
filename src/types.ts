export type ModelModalities = {
  input?: Array<"text" | "audio" | "image" | "video" | "pdf">;
  output?: Array<"text" | "audio" | "image" | "video" | "pdf">;
};

export type ModelLimits = {
  context: number;
  input?: number;
  output: number;
};

export type OpenCodeModel = {
  id?: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  limit?: ModelLimits;
  modalities?: ModelModalities;
  status?: "alpha" | "beta" | "deprecated" | "active";
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
};

export type ModelOverride = Partial<OpenCodeModel>;

export type GPUStackProfile = {
  id: string;
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  enabled?: boolean;
  include?: string[];
  exclude?: string[];
  modelOverrides?: Record<string, ModelOverride>;
};

export type DiscoveryConfig = {
  timeoutMs?: number;
};

export type GPUStackConfig = {
  version: 1;
  profiles: GPUStackProfile[];
  discovery?: DiscoveryConfig;
};

export type GPUStackModelResponse = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  meta?: Record<string, unknown> | null;
};

export type DiscoveredModel = {
  id: string;
  config: OpenCodeModel;
};

export type CacheSnapshot = {
  version: 1;
  profileId: string;
  baseURL: string;
  fetchedAt: string;
  models: DiscoveredModel[];
};

export type DiscoverySource = "live" | "cache";

export type ResolvedProfile = {
  profile: GPUStackProfile;
  models: DiscoveredModel[];
  source: DiscoverySource;
  fetchedAt: string;
  warning?: string;
};
