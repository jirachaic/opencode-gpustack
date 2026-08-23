import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "./config";
import type { CacheSnapshot, DiscoveredModel, GPUStackProfile } from "./types";

export function cacheDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    "opencode-gpustack",
  );
}

export function cachePath(
  profile: GPUStackProfile,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fingerprint = createHash("sha256")
    .update(profile.baseURL)
    .digest("hex")
    .slice(0, 12);
  return join(cacheDirectory(env), `${profile.id}-${fingerprint}.json`);
}

export async function writeCache(
  profile: GPUStackProfile,
  models: DiscoveredModel[],
  env = process.env,
): Promise<CacheSnapshot> {
  const snapshot: CacheSnapshot = {
    version: 1,
    profileId: profile.id,
    baseURL: profile.baseURL,
    fetchedAt: new Date().toISOString(),
    models,
  };
  await writeJsonAtomic(cachePath(profile, env), snapshot);
  return snapshot;
}

export async function readCache(
  profile: GPUStackProfile,
  env = process.env,
): Promise<CacheSnapshot | undefined> {
  try {
    const value = JSON.parse(
      await readFile(cachePath(profile, env), "utf8"),
    ) as CacheSnapshot;
    if (
      value.version !== 1 ||
      value.profileId !== profile.id ||
      value.baseURL !== profile.baseURL ||
      !Array.isArray(value.models)
    ) {
      return undefined;
    }
    return value;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    )
      return undefined;
    throw error;
  }
}

export async function listCaches(env = process.env): Promise<CacheSnapshot[]> {
  let names: string[];
  try {
    names = await readdir(cacheDirectory(env));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const snapshots = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          return JSON.parse(
            await readFile(join(cacheDirectory(env), name), "utf8"),
          ) as CacheSnapshot;
        } catch {
          return undefined;
        }
      }),
  );
  return snapshots.filter(
    (value): value is CacheSnapshot => value?.version === 1,
  );
}

export async function clearCaches(env = process.env): Promise<number> {
  const snapshots = await listCaches(env);
  await Promise.all(
    snapshots.map((snapshot) =>
      rm(
        cachePath(
          {
            id: snapshot.profileId,
            baseURL: snapshot.baseURL,
          } as GPUStackProfile,
          env,
        ),
      ),
    ),
  );
  return snapshots.length;
}
