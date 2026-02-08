import { describe, expect, it } from "vitest";
import {
  createDeterministicIdempotencyKey,
  stableSerialize,
} from "@/server/lib/idempotency";

describe("idempotency", () => {
  it("stable-serializes nested objects regardless of key order", () => {
    const left = stableSerialize({ b: 2, a: { z: 1, y: [3, 2, 1] } });
    const right = stableSerialize({ a: { y: [3, 2, 1], z: 1 }, b: 2 });
    expect(left).toBe(right);
  });

  it("creates deterministic hashes for equivalent payloads", () => {
    const first = createDeterministicIdempotencyKey("approval", {
      tool: "create",
      args: { resource: "calendar", data: { title: "Sync", durationMinutes: 30 } },
    });

    const second = createDeterministicIdempotencyKey("approval", {
      args: { data: { durationMinutes: 30, title: "Sync" }, resource: "calendar" },
      tool: "create",
    });

    expect(first).toBe(second);
  });
});
