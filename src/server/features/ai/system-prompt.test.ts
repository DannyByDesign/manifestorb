import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/server/features/ai/system-prompt";

describe("buildAgentSystemPrompt", () => {
  it("includes the assistant role and tone guidance", () => {
    const prompt = buildAgentSystemPrompt({
      platform: "slack",
      emailSendEnabled: true,
    });

    expect(prompt).toContain("Speak like a capable human assistant and teammate");
    expect(prompt).toContain("Use plain, modern English");
    expect(prompt).toContain("If the user asks what you can do");
  });

  it("includes user custom instructions when provided", () => {
    const prompt = buildAgentSystemPrompt({
      platform: "web",
      emailSendEnabled: true,
      userConfig: {
        customInstructions: "Use my preferred signing style.",
      },
    });

    expect(prompt).toContain("User custom instructions:");
    expect(prompt).toContain("Use my preferred signing style.");
  });
});
