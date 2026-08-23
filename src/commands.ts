import { readFile } from "node:fs/promises";
import { clearCaches, listCaches, readCache, writeCache } from "./cache";
import {
  detectOpenCodeVersion,
  isCompatibleOpenCodeVersion,
  MINIMUM_OPENCODE_VERSION,
} from "./compatibility";
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

export type CLIFlags = Record<string, string | boolean>;

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

async function commandContext(
  flags: CLIFlags,
): Promise<{ profiles: GPUStackProfile[]; timeoutMs: number }> {
  const config = await loadConfig();
  const profileID =
    typeof flags.profile === "string" ? flags.profile : undefined;
  return {
    profiles: selectedProfiles(config, profileID),
    timeoutMs: config.discovery?.timeoutMs ?? 5_000,
  };
}

export async function runInit(flags: CLIFlags): Promise<void> {
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
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Cannot update ${openCodePath}: ${safeError(error)}`);
    }
  }
  if (openCode.plugin !== undefined && !Array.isArray(openCode.plugin)) {
    throw new Error(`${openCodePath} plugin must be an array`);
  }
  const plugins = [...((openCode.plugin as unknown[] | undefined) ?? [])];
  const registered = plugins.some(
    (item) =>
      item === PACKAGE_NAME ||
      (Array.isArray(item) && item[0] === PACKAGE_NAME),
  );
  if (!registered) plugins.push(PACKAGE_NAME);
  openCode.plugin = plugins;
  await writeJsonAtomic(openCodePath, openCode);
  console.log(`Created ${destination}`);
  console.log(`Registered ${PACKAGE_NAME} in ${openCodePath}`);
  console.log(`Set ${config.profiles[0].apiKeyEnv} before starting OpenCode.`);
}

export async function runDiscover(flags: CLIFlags): Promise<void> {
  const context = await commandContext(flags);
  const output = await Promise.all(
    context.profiles.map(async (profile) => ({
      profile: profile.id,
      provider: `gpustack-${profile.id}`,
      models: await discover(
        { ...profile, modelOverrides: {} },
        { timeoutMs: context.timeoutMs },
      ),
    })),
  );
  if (flags.json) console.log(JSON.stringify(output, null, 2));
  else
    for (const item of output) {
      console.log(`${item.provider} (${item.models.length})`);
      for (const model of item.models) console.log(`  ${model.id}`);
    }
}

export async function runSync(flags: CLIFlags): Promise<void> {
  const context = await commandContext(flags);
  const results = await Promise.allSettled(
    context.profiles.map(async (profile) => {
      const before = await readCache(profile);
      const models = await discover(
        { ...profile, modelOverrides: {} },
        { timeoutMs: context.timeoutMs },
      );
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
    }),
  );
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === "rejected")
      console.error(
        `${context.profiles[index].id}: ${safeError(result.reason)}`,
      );
  }
  if (results.some((result) => result.status === "rejected"))
    process.exitCode = 1;
}

export async function runDoctor(flags: CLIFlags): Promise<void> {
  const context = await commandContext(flags);
  let failures = 0;
  console.log(`config: ok (${configPath()})`);
  try {
    const version = await detectOpenCodeVersion();
    if (!isCompatibleOpenCodeVersion(version)) {
      failures++;
      console.error(
        `opencode: ${version} is older than required ${MINIMUM_OPENCODE_VERSION}`,
      );
    } else console.log(`opencode: ok (${version})`);
  } catch (error) {
    failures++;
    console.error(`opencode: ${safeError(error)}`);
  }
  const results = await Promise.allSettled(
    context.profiles.map(async (profile) => {
      const warning = insecurePublicHttpWarning(profile.baseURL);
      if (warning) console.warn(`${profile.id}: warning: ${warning}`);
      if (!process.env[profile.apiKeyEnv])
        throw new Error(`${profile.id}: missing ${profile.apiKeyEnv}`);
      const models = await discover(profile, { timeoutMs: context.timeoutMs });
      const incomplete = models.filter((model) => !model.config.limit).length;
      console.log(`${profile.id}: ok (${models.length} LLM models)`);
      if (incomplete) {
        console.warn(
          `${profile.id}: warning: ${incomplete} model(s) lack complete context/output limits; configure modelOverrides if needed`,
        );
      }
    }),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      failures++;
      console.error(safeError(result.reason));
    }
  }
  if (failures > 0) process.exitCode = 1;
}

export async function runCache(command: string | undefined): Promise<void> {
  if (command === "list") {
    const snapshots = await listCaches();
    if (!snapshots.length) console.log("No cached model snapshots.");
    for (const snapshot of snapshots) {
      console.log(
        `${snapshot.profileId}\t${snapshot.models.length}\t${snapshot.fetchedAt}\t${snapshot.baseURL}`,
      );
    }
    return;
  }
  if (command === "clear") {
    console.log(`Cleared ${await clearCaches()} cached snapshot(s).`);
    return;
  }
  throw new Error("cache requires list or clear");
}
