import { describe, expect, test } from "bun:test";
import { isCompatibleOpenCodeVersion } from "../src/compatibility";

describe("OpenCode compatibility", () => {
  test.each([
    ["1.18.21", true],
    ["1.18.22", true],
    ["2.0.0", true],
    ["1.18.20", false],
    ["1.17.99", false],
    ["unknown", false],
  ])("evaluates %s", (version, expected) => {
    expect(isCompatibleOpenCodeVersion(version)).toBe(expected);
  });
});
