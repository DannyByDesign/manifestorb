import { createHash } from "crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonicalize(nested)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function createDeterministicIdempotencyKey(
  ...parts: unknown[]
): string {
  const payload = parts.map((part) => stableSerialize(part)).join("|");
  return createHash("sha256").update(payload).digest("hex");
}
