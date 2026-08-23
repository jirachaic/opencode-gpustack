import { isIP } from "node:net";

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  );
}

export function insecurePublicHttpWarning(baseURL: string): string | undefined {
  const url = new URL(baseURL);
  if (url.protocol !== "http:") return undefined;
  const host = url.hostname.toLowerCase();
  const localName =
    host === "localhost" || host.endsWith(".local") || host.endsWith(".ts.net");
  const privateAddress =
    isIP(host) === 4
      ? isPrivateIPv4(host)
      : host === "::1" || host.startsWith("fc") || host.startsWith("fd");
  if (localName || privateAddress) return undefined;
  return `Profile uses unencrypted HTTP on a potentially public host: ${host}`;
}

export function safeError(error: unknown): string {
  if (error instanceof Error)
    return error.message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  return String(error).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
