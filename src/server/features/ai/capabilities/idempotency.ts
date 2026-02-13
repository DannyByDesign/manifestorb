import { createHash } from "crypto";

export type IdempotencyScope = "message" | "thread" | "conversation" | "global";

export interface IdempotencyInput {
  scope: IdempotencyScope;
  userId: string;
  emailAccountId: string;
  capability: string;
  seed?: string;
  payload?: Record<string, unknown>;
}

function stableJson(input: unknown): string {
  return JSON.stringify(input, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return value;
  });
}

export function createCapabilityIdempotencyKey(input: IdempotencyInput): string {
  const base = [
    input.scope,
    input.userId,
    input.emailAccountId,
    input.capability,
    input.seed ?? "",
    stableJson(input.payload ?? {}),
  ].join(":");

  return createHash("sha256").update(base).digest("hex");
}
