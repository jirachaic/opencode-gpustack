import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { GPUStackConfig, GPUStackProfile, ModelOverride } from "./types";

export const DEFAULT_TIMEOUT_MS = 5_000;
export const PACKAGE_NAME = "opencode-gpustack";
export const PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OPENCODE_GPUSTACK_CONFIG) return env.OPENCODE_GPUSTACK_CONFIG;
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "opencode", "gpustack.json");
}

export function opencodeConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "opencode", "opencode.json");
}

export function normalizeBaseURL(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid GPUStack baseURL: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`GPUStack baseURL must use http or https: ${value}`);
  }
  parsed.search = "";
  parsed.hash = "";
  const pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`;
  return parsed.toString().replace(/\/$/, "");
}

function assertStringArray(
  value: unknown,
  field: string,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
}

function validateOverride(
  value: unknown,
  field: string,
): asserts value is ModelOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const override = value as Record<string, unknown>;
  if (override.limit !== undefined) {
    const limit = override.limit as Record<string, unknown>;
    if (!limit || typeof limit !== "object")
      throw new Error(`${field}.limit must be an object`);
    for (const key of ["context", "input", "output"] as const) {
      if (
        limit[key] !== undefined &&
        (typeof limit[key] !== "number" || limit[key] <= 0)
      ) {
        throw new Error(`${field}.limit.${key} must be a positive number`);
      }
    }
  }
}

function validateProfile(value: unknown, index: number): GPUStackProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`profiles[${index}] must be an object`);
  }
  const profile = value as Record<string, unknown>;
  if (typeof profile.id !== "string" || !PROFILE_ID_PATTERN.test(profile.id)) {
    throw new Error(`profiles[${index}].id must match ${PROFILE_ID_PATTERN}`);
  }
  if (typeof profile.name !== "string" || profile.name.trim() === "") {
    throw new Error(`profiles[${index}].name must be a non-empty string`);
  }
  if (typeof profile.baseURL !== "string")
    throw new Error(`profiles[${index}].baseURL is required`);
  if (
    typeof profile.apiKeyEnv !== "string" ||
    !ENV_NAME_PATTERN.test(profile.apiKeyEnv)
  ) {
    throw new Error(
      `profiles[${index}].apiKeyEnv must be an environment variable name`,
    );
  }
  if (profile.enabled !== undefined && typeof profile.enabled !== "boolean") {
    throw new Error(`profiles[${index}].enabled must be a boolean`);
  }
  if (profile.include !== undefined)
    assertStringArray(profile.include, `profiles[${index}].include`);
  if (profile.exclude !== undefined)
    assertStringArray(profile.exclude, `profiles[${index}].exclude`);
  if (profile.modelOverrides !== undefined) {
    if (
      !profile.modelOverrides ||
      typeof profile.modelOverrides !== "object" ||
      Array.isArray(profile.modelOverrides)
    ) {
      throw new Error(`profiles[${index}].modelOverrides must be an object`);
    }
    for (const [id, override] of Object.entries(profile.modelOverrides)) {
      if (!id)
        throw new Error(
          `profiles[${index}].modelOverrides contains an empty model id`,
        );
      validateOverride(override, `profiles[${index}].modelOverrides.${id}`);
    }
  }
  return {
    id: profile.id,
    name: profile.name.trim(),
    baseURL: normalizeBaseURL(profile.baseURL),
    apiKeyEnv: profile.apiKeyEnv,
    enabled: profile.enabled ?? true,
    include: profile.include ?? ["*"],
    exclude: profile.exclude ?? [],
    modelOverrides:
      (profile.modelOverrides as Record<string, ModelOverride> | undefined) ??
      {},
  };
}

export function validateConfig(value: unknown): GPUStackConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Configuration must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new Error("Configuration version must be 1");
  if (!Array.isArray(raw.profiles) || raw.profiles.length === 0) {
    throw new Error("Configuration must contain at least one profile");
  }
  const profiles = raw.profiles.map(validateProfile);
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id))
      throw new Error(`Duplicate profile id: ${profile.id}`);
    ids.add(profile.id);
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (raw.discovery !== undefined) {
    if (
      !raw.discovery ||
      typeof raw.discovery !== "object" ||
      Array.isArray(raw.discovery)
    ) {
      throw new Error("discovery must be an object");
    }
    const value = (raw.discovery as Record<string, unknown>).timeoutMs;
    if (
      value !== undefined &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 100 ||
        value > 120_000)
    ) {
      throw new Error(
        "discovery.timeoutMs must be an integer between 100 and 120000",
      );
    }
    timeoutMs = (value as number | undefined) ?? timeoutMs;
  }
  return { version: 1, profiles, discovery: { timeoutMs } };
}

export async function loadConfig(path = configPath()): Promise<GPUStackConfig> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`GPUStack configuration not found: ${path}`);
    }
    throw error;
  }
  try {
    return validateConfig(JSON.parse(contents));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`Invalid JSON in ${path}: ${error.message}`);
    throw error;
  }
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporary, path);
}
