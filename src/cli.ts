#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { clearCaches, listCaches, readCache, writeCache } from "./cache";
import {
  configPath,
  loadConfig,
  opencodeConfigPath,
  PACKAGE_NAME,
  validateConfig,
  writeJsonAtomic,
} from "./config";
import { discover } from "./discovery";
import { insecurePublicHttpWarning, safeError } from "./security";
import type { GPUStackConfig, GPUStackProfile } from "./types";

type Flags = Record<string, string | boolean>;

function parseArgs(args: string[]): {
  command?: string;
  rest: string[];
  flags: Flags;
} {
  const [command, ...tail] = args;
  const rest: string[] = [];
  const flags: Flags = {};
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

function usage(): string {
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

function selectedProfiles(
  config: GPUStackConfig,
  profileID: string | undefined,
): GPUStackProfile[] {
  const enabled = config.profiles.filter(
    (profile) => profile.enabled !== false,
  );
  if (!profileID) return enabled;
  const profile = enabled.find((item) => item.id === profileID);
  if (!profile) throw new Error(`Unknown or disabled profile: ${profileID}`);
  return [profile];
}

async function init(flags: Flags): Promise<void> {
  if (typeof flags["base-url"] !== "string")
    throw new Error("init requires --base-url URL");
  const profile: GPUStackProfile = {
    id: typeof flags.id === "string" ? flags.id : "default",
    name: typeof flags.name === "string" ? flags.name : "GPUStack",
    baseURL: flags["base-url"],
    apiKeyEnv:
      typeof flags["api-key-env"] === "string"
        ? flags["api-key-env"]
        : "GPUSTACK_API_KEY",
    enabled: true,
    include: ["*"],
    exclude: [],
    modelOverrides: {},
  };
  const config = validateConfig({
    version: 1,
    profiles: [profile],
    discovery: { timeoutMs: 5_000 },
  });
  const destination = configPath();
  if (!flags.force) {
    try {
      await readFile(destination, "utf8");
      throw new Error(
        `${destination} already exists; use --force to replace it`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await writeJsonAtomic(destination, config);

  const openCodePath = opencodeConfigPath();
  let openCode: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
  };
  try {
    openCode = JSON.parse(await readFile(openCodePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(`Cannot update ${openCodePath}: ${safeError(error)}`);
  }
  const plugins = Array.isArray(openCode.plugin)
    ? openCode.plugin.filter((item): item is string => typeof item === "string")
    : [];
  if (!plugins.includes(PACKAGE_NAME)) plugins.push(PACKAGE_NAME);
  openCode.plugin = plugins;
  await writeJsonAtomic(openCodePath, openCode);
  console.log(`Created ${destination}`);
  console.log(`Registered ${PACKAGE_NAME} in ${openCodePath}`);
  console.log(`Set ${config.profiles[0].apiKeyEnv} before starting OpenCode.`);
}

async function runDiscover(flags: Flags): Promise<void> {
  const config = await loadConfig();
  const profileID =
    typeof flags.profile === "string" ? flags.profile : undefined;
  const output = [];
  for (const profile of selectedProfiles(config, profileID)) {
    const models = await discover(profile, {
      timeoutMs: config.discovery?.timeoutMs ?? 5_000,
    });
    output.push({
      profile: profile.id,
      provider: `gpustack-${profile.id}`,
      models,
    });
  }
  if (flags.json) console.log(JSON.stringify(output, null, 2));
  else
    for (const item of output) {
      console.log(`${item.provider} (${item.models.length})`);
      for (const model of item.models) console.log(`  ${model.id}`);
    }
}

async function sync(flags: Flags): Promise<void> {
  const config = await loadConfig();
  const profileID =
    typeof flags.profile === "string" ? flags.profile : undefined;
  let failures = 0;
  for (const profile of selectedProfiles(config, profileID)) {
    try {
      const before = await readCache(profile);
      const models = await discover(profile, {
        timeoutMs: config.discovery?.timeoutMs ?? 5_000,
      });
      await writeCache(profile, models);
      const previous = new Set(before?.models.map((model) => model.id) ?? []);
      const current = new Set(models.map((model) => model.id));
      const added = [...current].filter((id) => !previous.has(id));
      const removed = [...previous].filter((id) => !current.has(id));
      console.log(
        `${profile.id}: ${models.length} models; +${added.length} -${removed.length}`,
      );
      if (added.length) console.log(`  added: ${added.join(", ")}`);
      if (removed.length) console.log(`  removed: ${removed.join(", ")}`);
    } catch (error) {
      failures++;
      console.error(`${profile.id}: ${safeError(error)}`);
    }
  }
  if (failures) process.exitCode = 1;
}

async function doctor(flags: Flags): Promise<void> {
  const config = await loadConfig();
  const profileID =
    typeof flags.profile === "string" ? flags.profile : undefined;
  let failures = 0;
  console.log(`config: ok (${configPath()})`);
  for (const profile of selectedProfiles(config, profileID)) {
    const warning = insecurePublicHttpWarning(profile.baseURL);
    if (warning) console.warn(`${profile.id}: warning: ${warning}`);
    if (!process.env[profile.apiKeyEnv]) {
      failures++;
      console.error(`${profile.id}: missing ${profile.apiKeyEnv}`);
      continue;
    }
    try {
      const models = await discover(profile, {
        timeoutMs: config.discovery?.timeoutMs ?? 5_000,
      });
      console.log(`${profile.id}: ok (${models.length} LLM models)`);
    } catch (error) {
      failures++;
      console.error(`${profile.id}: ${safeError(error)}`);
    }
  }
  if (failures) process.exitCode = 1;
}

async function cache(command: string | undefined): Promise<void> {
  if (command === "list") {
    const snapshots = await listCaches();
    if (!snapshots.length) console.log("No cached model snapshots.");
    for (const snapshot of snapshots)
      console.log(
        `${snapshot.profileId}\t${snapshot.models.length}\t${snapshot.fetchedAt}\t${snapshot.baseURL}`,
      );
    return;
  }
  if (command === "clear") {
    console.log(`Cleared ${await clearCaches()} cached snapshot(s).`);
    return;
  }
  throw new Error("cache requires list or clear");
}

async function main(): Promise<void> {
  const { command, rest, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || flags.help) {
    console.log(usage());
    return;
  }
  if (command === "init") await init(flags);
  else if (command === "discover") await runDiscover(flags);
  else if (command === "sync") await sync(flags);
  else if (command === "doctor") await doctor(flags);
  else if (command === "cache") await cache(rest[0]);
  else throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`opencode-gpustack: ${safeError(error)}`);
  process.exitCode = 1;
});
