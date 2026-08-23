import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function run(command: string[], cwd = process.cwd()) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr}`);
  return stdout;
}

const temporary = await mkdtemp(join(tmpdir(), "opencode-gpustack-package-"));
let archive: string | undefined;
try {
  const packed = JSON.parse(
    await run(["npm", "pack", "--json", "--ignore-scripts"]),
  ) as Array<{ filename: string }>;
  archive = resolve(packed[0].filename);
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({ private: true }),
  );
  await run(["bun", "add", archive], temporary);
  const output = await run(
    [join(temporary, "node_modules", ".bin", "opencode-gpustack"), "help"],
    temporary,
  );
  if (!output.includes("opencode-gpustack") || !output.includes("discover")) {
    throw new Error("Installed CLI did not return the expected help output");
  }
  const installed = JSON.parse(
    await readFile(
      join(temporary, "node_modules", "opencode-gpustack", "package.json"),
      "utf8",
    ),
  );
  console.log(`Package smoke passed: ${installed.name}@${installed.version}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
  if (archive) await unlink(archive).catch(() => undefined);
}
