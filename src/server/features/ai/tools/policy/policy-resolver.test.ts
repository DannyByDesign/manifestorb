import { describe, expect, it } from "vitest";
import { resolveEffectiveToolPolicy } from "@/server/features/ai/tools/policy/policy-resolver";

describe("policy resolver", () => {
  it("resolves provider-specific policy by provider/model key", () => {
    const resolved = resolveEffectiveToolPolicy({
      config: {
        toolAllow: ["group:inbox_read"],
        toolByProvider: {
          google: {
            allow: ["group:calendar_read"],
            profile: "messaging",
          },
          "google/gemini-2.5-flash": {
            deny: ["calendar.deleteEvent"],
            profile: "minimal",
          },
        },
      },
      modelProvider: "google",
      modelId: "gemini-2.5-flash",
    });

    expect(resolved.globalPolicy?.allow).toEqual(["group:inbox_read"]);
    expect(resolved.globalProviderPolicy?.deny).toEqual(["calendar.deleteEvent"]);
    expect(resolved.providerProfile).toBe("minimal");
    expect(resolved.providerProfilePolicy?.allow).toEqual(["group:inbox_read", "group:calendar_read"]);
  });

  it("resolves group policy with channel/group compound key first", () => {
    const resolved = resolveEffectiveToolPolicy({
      config: {
        toolByGroup: {
          "slack/group-1": {
            allow: ["email.searchInbox"],
          },
          "group-1": {
            allow: ["calendar.listEvents"],
          },
          "*": {
            allow: ["planner.planDay"],
          },
        },
      },
      groupId: "group-1",
      groupChannel: "slack",
      channelId: "D123",
    });

    expect(resolved.groupPolicy?.allow).toEqual(["email.searchInbox"]);
  });

  it("supports agent-scoped policy and provider-scoped agent override", () => {
    const resolved = resolveEffectiveToolPolicy({
      config: {
        toolByAgent: {
          assistant: {
            tools: {
              allow: ["email.*"],
            },
            byProvider: {
              microsoft: {
                deny: ["email.batchTrash"],
              },
            },
          },
        },
      },
      agentId: "assistant",
      modelProvider: "microsoft",
    });

    expect(resolved.agentPolicy?.allow).toEqual(["email.*"]);
    expect(resolved.agentProviderPolicy?.deny).toEqual(["email.batchTrash"]);
  });
});
