#!/usr/bin/env bun
import {
  type CLIFlags,
  runCache,
  runDiscover,
  runDoctor,
  runInit,
  runSync,
} from "./commands";
import { safeError } from "./security";

export function parseArgs(args: string[]): {
  command?: string;
  rest: string[];
  flags: CLIFlags;
} {
  const [command, ...tail] = args;
  const rest: string[] = [];
  const flags: CLIFlags = {};
  for (let index = 0; index < tail.length; index++) {
    const value = tail[index];
    if (!value.startsWith("--")) {
      rest.push(value);
      continue;
    }
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) flags[key] = inline;
    else if (tail[index + 1] && !tail[index + 1].startsWith("--"))
      flags[key] = tail[++index];
    else flags[key] = true;
  }
  return { command, rest, flags };
}

export function usage(): string {
  return `opencode-gpustack

Commands:
  init --base-url URL [--id ID] [--name NAME] [--api-key-env NAME] [--force]
  discover [--profile ID] [--json]
  sync [--profile ID]
  doctor [--profile ID]
  cache list
  cache clear
`;
}

async function main(): Promise<void> {
  const { command, rest, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || flags.help) return console.log(usage());
  if (command === "init") await runInit(flags);
  else if (command === "discover") await runDiscover(flags);
  else if (command === "sync") await runSync(flags);
  else if (command === "doctor") await runDoctor(flags);
  else if (command === "cache") await runCache(rest[0]);
  else throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`opencode-gpustack: ${safeError(error)}`);
  process.exitCode = 1;
});
