import { describe, expect, it } from "vitest";
import { executeToolCall } from "@/server/features/ai/runtime/tool-runtime";

describe("executeToolCall message sanitization", () => {
  it("strips tool-layer messages for successful results", async () => {
    const result = await executeToolCall({
      context: {
        session: {
          toolHarness: {
            toolLookup: new Map([
              [
                "email.searchInbox",
                {
                  execute: async () => ({
                    success: true,
                    message: "Loaded 10 messages.",
                    data: { items: [] },
                  }),
                },
              ],
            ]),
          },
        },
      } as never,
      decision: {
        toolName: "email.searchInbox",
        args: {},
      },
    });

    expect(result.success).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("strips tool-layer messages for clarification results", async () => {
    const result = await executeToolCall({
      context: {
        session: {
          toolHarness: {
            toolLookup: new Map([
              [
                "email.searchInbox",
                {
                  execute: async () => ({
                    success: false,
                    error: "clarification_required",
                    message: "I need a sender.",
                    clarification: {
                      kind: "missing_fields",
                      prompt: "email_sender_required",
                      missingFields: ["from"],
                    },
                  }),
                },
              ],
            ]),
          },
        },
      } as never,
      decision: {
        toolName: "email.searchInbox",
        args: {},
      },
    });

    expect(result.success).toBe(false);
    expect(result.clarification).toBeTruthy();
    expect(result.message).toBeUndefined();
  });

  it("keeps messages for hard error paths", async () => {
    const result = await executeToolCall({
      context: {
        session: {
          toolHarness: {
            toolLookup: new Map([
              [
                "email.searchInbox",
                {
                  execute: async () => ({
                    success: false,
                    error: "provider_unavailable",
                    message: "Provider unavailable.",
                  }),
                },
              ],
            ]),
          },
        },
      } as never,
      decision: {
        toolName: "email.searchInbox",
        args: {},
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Provider unavailable.");
  });
});
