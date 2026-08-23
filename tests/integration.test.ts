import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GPUStackPlugin } from "../src/index";

const directories: string[] = [];
afterEach(async () => {
  delete process.env.OPENCODE_GPUSTACK_CONFIG;
  delete process.env.GPUSTACK_ONE_KEY;
  delete process.env.GPUSTACK_TWO_KEY;
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("OpenCode plugin integration", () => {
  test("adds multiple providers while isolating a failed profile", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "opencode-gpustack-integration-"),
    );
    directories.push(directory);
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.headers.get("authorization")).toBe("Bearer one-key");
        return Response.json({ data: [{ id: "qwen3" }] });
      },
    });
    const configFile = join(directory, "gpustack.json");
    await writeFile(
      configFile,
      JSON.stringify({
        version: 1,
        profiles: [
          {
            id: "one",
            name: "One",
            baseURL: `http://127.0.0.1:${server.port}/v1`,
            apiKeyEnv: "GPUSTACK_ONE_KEY",
          },
          {
            id: "two",
            name: "Two",
            baseURL: "https://two.example/v1",
            apiKeyEnv: "GPUSTACK_TWO_KEY",
          },
        ],
        discovery: { timeoutMs: 100 },
      }),
    );
    process.env.OPENCODE_GPUSTACK_CONFIG = configFile;
    process.env.XDG_CACHE_HOME = directory;
    process.env.GPUSTACK_ONE_KEY = "one-key";
    try {
      const hooks = await GPUStackPlugin({} as never);
      const config: { provider?: Record<string, Record<string, unknown>> } = {};
      await hooks.config?.(config as never);
      const provider = config.provider?.["gpustack-one"] as {
        models: Record<string, { name: string }>;
        options: { apiKey: string };
      };
      expect(provider.models.qwen3.name).toBe("qwen3");
      expect(provider.options.apiKey).toBe("one-key");
      expect(config.provider?.["gpustack-two"]).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("built CLI can discover from a mock GPUStack server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-gpustack-cli-"));
    directories.push(directory);
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.headers.get("authorization")).toBe("Bearer cli-key");
        return Response.json({
          data: [{ id: "qwen-cli", meta: { categories: ["llm"] } }],
        });
      },
    });
    try {
      const configFile = join(directory, "gpustack.json");
      await writeFile(
        configFile,
        JSON.stringify({
          version: 1,
          profiles: [
            {
              id: "local",
              name: "Local",
              baseURL: `http://127.0.0.1:${server.port}`,
              apiKeyEnv: "GPUSTACK_CLI_KEY",
            },
          ],
        }),
      );
      const proc = Bun.spawn(
        [process.execPath, "src/cli.ts", "discover", "--json"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            OPENCODE_GPUSTACK_CONFIG: configFile,
            GPUSTACK_CLI_KEY: "cli-key",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)[0].models[0].id).toBe("qwen-cli");
    } finally {
      server.stop(true);
    }
  });
});
