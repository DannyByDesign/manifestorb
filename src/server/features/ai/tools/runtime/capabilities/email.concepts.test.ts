import { describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";

function buildEnv(): CapabilityEnvironment {
  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "account-1",
      email: "user@example.com",
      provider: "web",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "account-1",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
      providers: {
        email: {} as never,
        calendar: {} as never,
      },
    },
  };
}

describe("email concept clarification", () => {
  it("returns clarification when fromConcept is provided", async () => {
    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.search({
      fromConcept: "recruiters",
      unread: true,
      sort: "newest",
    });

    expect(result.success).toBe(false);
    expect(result.clarification?.kind).toBe("concept_definition_required");
    expect(result.clarification?.prompt).toBe("email_identity_concept_requires_definition");
    expect(result.data).toMatchObject({
      concept: { field: "from", value: "recruiters" },
    });
  });
});
