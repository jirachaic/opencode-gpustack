import { describe, expect, test } from "bun:test";
import { isIncluded, mapModel, matchesGlob, parseModels } from "../src/models";
import type { GPUStackProfile } from "../src/types";

const profile: GPUStackProfile = {
  id: "bkk",
  name: "BKK",
  baseURL: "https://gpu.example.com/v1",
  apiKeyEnv: "GPUSTACK_KEY",
  include: ["qwen*"],
  exclude: ["*-embed"],
  modelOverrides: {},
};

describe("model mapping", () => {
  test("matches include and exclude globs", () => {
    expect(matchesGlob("qwen3-coder", "qwen*")).toBe(true);
    expect(isIncluded("qwen-embed", ["qwen*"], ["*-embed"])).toBe(false);
  });

  test("maps GPUStack metadata and applies overrides last", () => {
    const model = mapModel(
      {
        id: "qwen3",
        meta: {
          name: "Qwen 3",
          token_limits: {
            context_window: 32768,
            max_input_token_length: 30000,
            max_output_token_length: 4096,
          },
          modalities: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
          },
          features: { tools: { function_calling: true } },
          capabilities: ["reasoning"],
        },
      },
      { name: "Local Qwen", limit: { context: 16384, output: 2048 } },
    );
    expect(model).toEqual({
      id: "qwen3",
      config: {
        id: "qwen3",
        name: "Local Qwen",
        status: "active",
        limit: { context: 16384, input: 30000, output: 2048 },
        modalities: { input: ["text", "image"], output: ["text"] },
        attachment: true,
        tool_call: true,
        reasoning: true,
      },
    });
  });

  test("filters non-LLMs and configured exclusions", () => {
    const models = parseModels(
      {
        data: [
          { id: "qwen3", meta: { categories: ["llm"] } },
          { id: "qwen-embed", meta: { categories: ["embedding"] } },
          { id: "llama3", meta: { categories: ["llm"] } },
        ],
      },
      profile,
    );
    expect(models.map((model) => model.id)).toEqual(["qwen3"]);
  });

  test("rejects duplicate and malformed model IDs", () => {
    expect(() =>
      parseModels(
        { data: [{ id: "same" }, { id: "same" }] },
        { ...profile, include: ["*"] },
      ),
    ).toThrow("duplicate");
    expect(() => parseModels({ data: [{}] }, profile)).toThrow("valid id");
  });
});
