import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cacheDirectory,
  cachePath,
  clearCaches,
  readCache,
  writeCache,
} from "../src/cache";
import { discover, modelsURL, resolveProfile } from "../src/discovery";
import type { GPUStackProfile } from "../src/types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const profile: GPUStackProfile = {
  id: "bkk",
  name: "GPUStack BKK",
  baseURL: "https://gpu.example.com/v1",
  apiKeyEnv: "GPUSTACK_KEY",
  include: ["*"],
  exclude: [],
  modelOverrides: {},
};

describe("discovery and cache", () => {
  test("uses the authenticated LLM discovery endpoint", async () => {
    let request: Request | undefined;
    const models = await discover(profile, {
      timeoutMs: 1_000,
      env: { GPUSTACK_KEY: "super-secret" },
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ data: [{ id: "qwen3" }] });
      },
    });
    expect(modelsURL(profile)).toBe(
      "https://gpu.example.com/v1/models?categories=llm&with_meta=true",
    );
    expect(request?.headers.get("authorization")).toBe("Bearer super-secret");
    expect(models[0].id).toBe("qwen3");
  });

  test.each([401, 500])(
    "reports HTTP %s without exposing credentials",
    async (status) => {
      await expect(
        discover(profile, {
          timeoutMs: 1_000,
          env: { GPUSTACK_KEY: "super-secret" },
          fetch: async () => new Response("no", { status }),
        }),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );

  test("times out stalled requests", async () => {
    await expect(
      discover(profile, {
        timeoutMs: 10,
        env: { GPUSTACK_KEY: "secret" },
        fetch: async (_input, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      }),
    ).rejects.toThrow("timed out");
  });

  test("falls back to an endpoint-isolated cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-"));
    directories.push(directory);
    const env = { XDG_CACHE_HOME: directory, GPUSTACK_KEY: "secret" };
    await writeCache(
      profile,
      [{ id: "cached", config: { name: "Cached" } }],
      env,
    );
    const result = await resolveProfile(profile, {
      timeoutMs: 100,
      env,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    expect(result.source).toBe("cache");
    expect(result.models[0].id).toBe("cached");
    expect(result.warning).toContain("offline");
    expect(cachePath(profile, env)).not.toBe(
      cachePath({ ...profile, baseURL: "https://other.example/v1" }, env),
    );
    expect(
      await readCache({ ...profile, baseURL: "https://other.example/v1" }, env),
    ).toBeUndefined();
  });

  test("does not hide authentication or contract failures with cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-"));
    directories.push(directory);
    const env = { XDG_CACHE_HOME: directory, GPUSTACK_KEY: "bad-key" };
    await writeCache(
      profile,
      [{ id: "cached", config: { name: "Cached" } }],
      env,
    );
    await expect(
      resolveProfile(profile, {
        timeoutMs: 100,
        env,
        fetch: async () => new Response("unauthorized", { status: 401 }),
      }),
    ).rejects.toThrow("HTTP 401");
    await expect(
      resolveProfile(profile, {
        timeoutMs: 100,
        env,
        fetch: async () => Response.json({ unexpected: [] }),
      }),
    ).rejects.toThrow("invalid model payload");
  });

  test("applies overrides after caching so secrets are never persisted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-"));
    directories.push(directory);
    const env = { XDG_CACHE_HOME: directory, GPUSTACK_KEY: "secret" };
    const configured = {
      ...profile,
      modelOverrides: {
        qwen: { headers: { Authorization: "Bearer model-secret" } },
      },
    };
    const result = await resolveProfile(configured, {
      timeoutMs: 100,
      env,
      fetch: async () => Response.json({ data: [{ id: "qwen" }] }),
    });
    expect(result.models[0].config.headers?.Authorization).toContain(
      "model-secret",
    );
    const cached = await readCache(configured, env);
    expect(JSON.stringify(cached)).not.toContain("model-secret");
  });

  test("cache clear removes valid and corrupt snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-"));
    directories.push(directory);
    const env = { XDG_CACHE_HOME: directory };
    await writeCache(profile, [], env);
    await Bun.write(join(cacheDirectory(env), "corrupt.json"), "not json");
    expect(await clearCaches(env)).toBe(2);
    expect(await readCache(profile, env)).toBeUndefined();
  });
});
