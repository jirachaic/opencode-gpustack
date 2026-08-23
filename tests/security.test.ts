import { describe, expect, test } from "bun:test";
import { insecurePublicHttpWarning, safeError } from "../src/security";

describe("security helpers", () => {
  test.each([
    "http://127.0.0.1:8080/v1",
    "http://10.0.0.2/v1",
    "http://100.100.1.1/v1",
    "http://server.tailnet.ts.net/v1",
    "https://public.example.com/v1",
  ])("allows private, Tailscale, and encrypted endpoints: %s", (url) => {
    expect(insecurePublicHttpWarning(url)).toBeUndefined();
  });

  test("warns for potentially public plain HTTP", () => {
    expect(insecurePublicHttpWarning("http://public.example.com/v1")).toContain(
      "unencrypted HTTP",
    );
  });

  test("redacts bearer credentials from errors", () => {
    expect(safeError(new Error("request had Bearer secret-value"))).toBe(
      "request had Bearer [REDACTED]",
    );
  });
});
