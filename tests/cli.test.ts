import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCache, writeCache } from "../src/cache";
import type { GPUStackProfile } from "../src/types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runCLI(args: string[], env: NodeJS.ProcessEnv) {
  const child = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("CLI", () => {
  test("init preserves existing plugin entries and refuses accidental overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-cli-"));
    directories.push(directory);
    const env = { XDG_CONFIG_HOME: directory };
    const opencodeDirectory = join(directory, "opencode");
    await mkdir(opencodeDirectory, { recursive: true });
    await writeFile(
      join(opencodeDirectory, "opencode.json"),
      JSON.stringify({ plugin: [["existing-plugin", { enabled: true }]] }),
    );
    const first = await runCLI(
      ["init", "--id", "bkk", "--base-url", "https://gpu.example.com"],
      env,
    );
    expect(first.exitCode).toBe(0);
    const opencode = JSON.parse(
      await readFile(join(opencodeDirectory, "opencode.json"), "utf8"),
    );
    expect(opencode.plugin).toEqual([
      ["existing-plugin", { enabled: true }],
      "opencode-gpustack",
    ]);
    const second = await runCLI(
      ["init", "--id", "bkk", "--base-url", "https://gpu.example.com"],
      env,
    );
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("already exists");
  });

  test("cache list and clear report persisted snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-cli-"));
    directories.push(directory);
    const env = { XDG_CACHE_HOME: directory };
    const profile: GPUStackProfile = {
      id: "bkk",
      name: "BKK",
      baseURL: "https://gpu.example.com/v1",
      apiKeyEnv: "GPUSTACK_KEY",
    };
    await writeCache(profile, [{ id: "qwen", config: { name: "Qwen" } }], env);
    const listed = await runCLI(["cache", "list"], env);
    expect(listed.stdout).toContain("bkk\t1");
    const cleared = await runCLI(["cache", "clear"], env);
    expect(cleared.stdout).toContain("Cleared 1 cached snapshot");
  });

  test("sync reports a missing credential and exits non-zero", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-cli-"));
    directories.push(directory);
    const configFile = join(directory, "gpustack.json");
    await writeFile(
      configFile,
      JSON.stringify({
        version: 1,
        profiles: [
          {
            id: "bkk",
            name: "BKK",
            baseURL: "https://gpu.example.com",
            apiKeyEnv: "MISSING_GPUSTACK_KEY",
          },
        ],
      }),
    );
    const result = await runCLI(["sync"], {
      OPENCODE_GPUSTACK_CONFIG: configFile,
      MISSING_GPUSTACK_KEY: undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing API key environment variable");
  });

  test("sync reports model differences and doctor validates compatibility", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-cli-"));
    directories.push(directory);
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ data: [{ id: "new-model" }] });
      },
    });
    try {
      const configFile = join(directory, "gpustack.json");
      const profile: GPUStackProfile = {
        id: "bkk",
        name: "BKK",
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        apiKeyEnv: "GPUSTACK_KEY",
        modelOverrides: {
          "new-model": {
            headers: { Authorization: "Bearer must-not-be-cached" },
          },
        },
      };
      await writeFile(
        configFile,
        JSON.stringify({ version: 1, profiles: [profile] }),
      );
      await writeCache(
        profile,
        [{ id: "old-model", config: { name: "Old" } }],
        {
          XDG_CACHE_HOME: directory,
        },
      );
      const fakeOpenCode = join(directory, "opencode");
      await writeFile(fakeOpenCode, "#!/bin/sh\necho 1.18.21\n");
      await chmod(fakeOpenCode, 0o700);
      const env = {
        OPENCODE_GPUSTACK_CONFIG: configFile,
        XDG_CACHE_HOME: directory,
        GPUSTACK_KEY: "secret",
        OPENCODE_BIN: fakeOpenCode,
      };

      const synced = await runCLI(["sync"], env);
      expect(synced.exitCode).toBe(0);
      expect(synced.stdout).toContain("+1 -1");
      expect(synced.stdout).toContain("added: new-model");
      expect(synced.stdout).toContain("removed: old-model");
      expect(JSON.stringify(await readCache(profile, env))).not.toContain(
        "must-not-be-cached",
      );

      const diagnosed = await runCLI(["doctor"], env);
      expect(diagnosed.exitCode).toBe(0);
      expect(diagnosed.stdout).toContain("opencode: ok (1.18.21)");
      expect(diagnosed.stdout).toContain("bkk: ok (1 LLM models)");
      expect(diagnosed.stderr).toContain("lack complete context/output limits");
    } finally {
      server.stop(true);
    }
  });

  test("doctor aggregates incompatible OpenCode and credential failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-cli-"));
    directories.push(directory);
    const configFile = join(directory, "gpustack.json");
    await writeFile(
      configFile,
      JSON.stringify({
        version: 1,
        profiles: [
          {
            id: "bkk",
            name: "BKK",
            baseURL: "https://gpu.example.com",
            apiKeyEnv: "MISSING_KEY",
          },
        ],
      }),
    );
    const fakeOpenCode = join(directory, "opencode");
    await writeFile(fakeOpenCode, "#!/bin/sh\necho 1.18.20\n");
    await chmod(fakeOpenCode, 0o700);
    const result = await runCLI(["doctor"], {
      OPENCODE_GPUSTACK_CONFIG: configFile,
      OPENCODE_BIN: fakeOpenCode,
      MISSING_KEY: undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("older than required 1.18.21");
    expect(result.stderr).toContain("missing MISSING_KEY");
  });
});
