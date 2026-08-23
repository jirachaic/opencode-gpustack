import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function run(
  command: string[],
  options: { env: NodeJS.ProcessEnv; cwd?: string },
) {
  const process = Bun.spawn(command, {
    env: options.env,
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("OpenCode lists a discovered model and routes chat to GPUStack", async () => {
  const binary = process.env.OPENCODE_BIN || Bun.which("opencode");
  if (!binary)
    throw new Error("Set OPENCODE_BIN to run the OpenCode compatibility test");
  const directory = await mkdtemp(
    join(tmpdir(), "opencode-gpustack-opencode-"),
  );
  directories.push(directory);
  const seen: string[] = [];
  const encoder = new TextEncoder();
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      seen.push(`${request.method} ${path}`);
      expect(request.headers.get("authorization")).toBe("Bearer e2e-key");
      if (path.endsWith("/models")) {
        return Response.json({
          object: "list",
          data: [
            {
              id: "qwen-e2e",
              object: "model",
              owned_by: "gpustack",
              meta: {
                categories: ["llm"],
                token_limits: {
                  context_window: 32768,
                  max_output_token_length: 4096,
                },
                capabilities: ["tools"],
              },
            },
          ],
        });
      }
      if (path.endsWith("/chat/completions")) {
        const stream = new ReadableStream({
          start(controller) {
            const chunk = {
              id: "chatcmpl-e2e",
              object: "chat.completion.chunk",
              created: Date.now(),
              model: "qwen-e2e",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: "GPUStack route reached",
                  },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
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
            id: "e2e",
            name: "GPUStack E2E",
            baseURL: `http://127.0.0.1:${server.port}/v1`,
            apiKeyEnv: "GPUSTACK_E2E_KEY",
          },
        ],
      }),
    );
    const configHome = join(directory, "config");
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: configHome,
      XDG_CACHE_HOME: join(directory, "cache"),
      OPENCODE_GPUSTACK_CONFIG: configFile,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        plugin: [resolve("dist/index.js")],
      }),
      GPUSTACK_E2E_KEY: "e2e-key",
    };

    const models = await run([binary, "models", "gpustack-e2e"], { env });
    expect(models.exitCode).toBe(0);
    expect(models.stdout).toContain("gpustack-e2e/qwen-e2e");

    const debug = await run([binary, "debug", "config"], { env });
    expect(debug.exitCode).toBe(0);
    expect(debug.stdout).not.toContain("e2e-key");

    const chat = await run(
      [
        binary,
        "run",
        "--model",
        "gpustack-e2e/qwen-e2e",
        "--format",
        "json",
        "Reply briefly.",
      ],
      { env, cwd: directory },
    );
    expect(chat.exitCode).toBe(0);
    expect(chat.stdout).toContain("GPUStack route reached");
    expect(seen).toContain("GET /v1/models");
    expect(seen).toContain("POST /v1/chat/completions");
  } finally {
    server.stop(true);
  }
}, 30_000);
