import { describe, expect, test } from "bun:test";
import { normalizeBaseURL, validateConfig } from "../src/config";

const valid = {
  version: 1,
  profiles: [
    {
      id: "bkk",
      name: "GPUStack BKK",
      baseURL: "https://gpu.example.com",
      apiKeyEnv: "GPUSTACK_BKK_API_KEY",
    },
  ],
};

describe("configuration", () => {
  test("normalizes the OpenAI base path", () => {
    expect(normalizeBaseURL("https://gpu.example.com/")).toBe(
      "https://gpu.example.com/v1",
    );
    expect(normalizeBaseURL("https://gpu.example.com/prefix/v1/")).toBe(
      "https://gpu.example.com/prefix/v1",
    );
  });

  test("applies safe defaults", () => {
    const config = validateConfig(valid);
    expect(config.discovery?.timeoutMs).toBe(5_000);
    expect(config.profiles[0].include).toEqual(["*"]);
    expect(config.profiles[0].exclude).toEqual([]);
  });

  test.each([
    [
      "duplicate IDs",
      { ...valid, profiles: [valid.profiles[0], valid.profiles[0]] },
      "Duplicate profile id",
    ],
    [
      "unsafe ID",
      { ...valid, profiles: [{ ...valid.profiles[0], id: "BKK/one" }] },
      "must match",
    ],
    [
      "missing environment name",
      { ...valid, profiles: [{ ...valid.profiles[0], apiKeyEnv: "" }] },
      "environment variable",
    ],
    [
      "bad URL",
      { ...valid, profiles: [{ ...valid.profiles[0], baseURL: "not a url" }] },
      "Invalid GPUStack baseURL",
    ],
    [
      "bad override",
      {
        ...valid,
        profiles: [
          {
            ...valid.profiles[0],
            modelOverrides: { qwen: { limit: { context: -1, output: 1 } } },
          },
        ],
      },
      "positive number",
    ],
  ])("rejects %s", (_name, input, message) => {
    expect(() => validateConfig(input)).toThrow(message as string);
  });
});
