export const MINIMUM_OPENCODE_VERSION = "1.18.21";

function parseVersion(value: string): [number, number, number] | undefined {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isCompatibleOpenCodeVersion(value: string): boolean {
  const actual = parseVersion(value);
  const minimum = parseVersion(MINIMUM_OPENCODE_VERSION);
  if (!actual || !minimum) return false;
  for (let index = 0; index < actual.length; index++) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

export async function detectOpenCodeVersion(
  binary = process.env.OPENCODE_BIN || "opencode",
): Promise<string> {
  const child = Bun.spawn([binary, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Unable to run ${binary}: ${stderr.trim() || `exit ${exitCode}`}`,
    );
  }
  return stdout.trim();
}
