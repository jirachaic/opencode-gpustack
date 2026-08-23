import type {
  DiscoveredModel,
  GPUStackModelResponse,
  GPUStackProfile,
  ModelOverride,
  OpenCodeModel,
} from "./types";

const MODALITIES = new Set(["text", "audio", "image", "video", "pdf"]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveNumber(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0,
  );
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (item): item is string => typeof item === "string",
  );
  return values.length > 0 ? values : undefined;
}

function modalities(value: unknown): ModelModalities | undefined {
  const raw = object(value);
  if (!raw) return undefined;
  const input = strings(raw.input_modalities ?? raw.input)?.filter((item) =>
    MODALITIES.has(item),
  ) as ModelModalities["input"];
  const output = strings(raw.output_modalities ?? raw.output)?.filter((item) =>
    MODALITIES.has(item),
  ) as ModelModalities["output"];
  return input?.length || output?.length ? { input, output } : undefined;
}

type ModelModalities = NonNullable<OpenCodeModel["modalities"]>;

function mergeModel(
  base: OpenCodeModel,
  override: ModelOverride | undefined,
): OpenCodeModel {
  if (!override) return base;
  return {
    ...base,
    ...override,
    limit: override.limit
      ? ({ ...base.limit, ...override.limit } as OpenCodeModel["limit"])
      : base.limit,
    modalities: override.modalities
      ? { ...base.modalities, ...override.modalities }
      : base.modalities,
    options: override.options
      ? { ...base.options, ...override.options }
      : base.options,
    headers: override.headers
      ? { ...base.headers, ...override.headers }
      : base.headers,
  };
}

export function matchesGlob(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function isIncluded(
  id: string,
  include: string[],
  exclude: string[],
): boolean {
  return (
    include.some((pattern) => matchesGlob(id, pattern)) &&
    !exclude.some((pattern) => matchesGlob(id, pattern))
  );
}

export function mapModel(
  model: GPUStackModelResponse,
  override?: ModelOverride,
): DiscoveredModel {
  const meta = object(model.meta) ?? {};
  const tokenLimits = object(meta.token_limits) ?? {};
  const features = object(meta.features) ?? {};
  const tools = object(features.tools) ?? {};
  const capabilities = strings(meta.capabilities) ?? [];
  const mappedModalities = modalities(meta.modalities);
  const context = positiveNumber(
    tokenLimits.context_window,
    meta.context_window,
    meta.max_model_len,
  );
  const output = positiveNumber(
    tokenLimits.max_output_token_length,
    meta.max_output_tokens,
  );
  const input = positiveNumber(
    tokenLimits.max_input_token_length,
    meta.max_input_tokens,
  );
  const config: OpenCodeModel = {
    id: model.id,
    name: typeof meta.name === "string" ? meta.name : model.id,
    status: "active",
  };
  if (context && output)
    config.limit = { context, output, ...(input ? { input } : {}) };
  if (mappedModalities) {
    config.modalities = mappedModalities;
    if (mappedModalities.input?.includes("image")) config.attachment = true;
  }
  if (tools.function_calling === true || capabilities.includes("tools"))
    config.tool_call = true;
  if (features.reasoning === true || capabilities.includes("reasoning"))
    config.reasoning = true;
  return { id: model.id, config: mergeModel(config, override) };
}

export function parseModels(
  payload: unknown,
  profile: GPUStackProfile,
): DiscoveredModel[] {
  const envelope = object(payload);
  if (!envelope || !Array.isArray(envelope.data))
    throw new Error("GPUStack response must contain a data array");
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of envelope.data) {
    const raw = object(item);
    if (!raw || typeof raw.id !== "string" || raw.id.trim() === "")
      throw new Error("GPUStack returned a model without a valid id");
    const id = raw.id;
    if (seen.has(id))
      throw new Error(`GPUStack returned duplicate model id: ${id}`);
    seen.add(id);
    const meta = object(raw.meta);
    const categories = strings(meta?.categories ?? raw.categories);
    if (categories && !categories.includes("llm")) continue;
    if (!isIncluded(id, profile.include ?? ["*"], profile.exclude ?? []))
      continue;
    models.push(
      mapModel(raw as GPUStackModelResponse, profile.modelOverrides?.[id]),
    );
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}
