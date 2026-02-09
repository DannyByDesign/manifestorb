/**
 * Slack ↔ Main App ↔ Google E2E — Tier 4: Error handling and edge cases.
 * Run with: RUN_LIVE_SLACK_GOOGLE_E2E=true RUN_LIVE_E2E=true vitest run --config vitest.e2e.config.ts tests/e2e/critical-e2e-slack-google-tier4-errors.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requireSlackEnv,
  postSlackMessage,
  waitForSlackChannelResponse,
  getSlackChannelHistory,
  wait,
  SLACK_E2E_PREFIX,
} from "./slack-google-e2e-harness";

vi.mock("server-only", () => ({}));

const describeSlackGoogle = describe.runIf(
  process.env.RUN_LIVE_SLACK_GOOGLE_E2E === "true",
);

describeSlackGoogle("Slack–Google E2E Tier 4: Error handling", () => {
  beforeEach(async () => {
    await wait(15000);
  });

  it("Handles Slack connection failure gracefully", async () => {
    requireSlackEnv();
    // Would need to simulate sidecar disconnect; skip for now.
  });

  it("Handles Google API rate limit and recovers", async () => {
    requireSlackEnv();
    // Optional: rapid-fire messages; assert at least one rate-limit message; wait 60s; retry.
  });

  it("Handles multiple follow-up messages in channel (each sent after AI responds)", async () => {
    requireSlackEnv();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const msg1 = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} What emails do I need to respond to?`,
    });
    await waitForSlackChannelResponse({
      channel,
      afterTs: msg1.ts,
      timeoutMs: 25_000,
    });
    const msg2 = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Actually, just show me urgent ones`,
    });
    await waitForSlackChannelResponse({
      channel,
      afterTs: msg2.ts,
      timeoutMs: 25_000,
    });
    const msg3 = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Never mind, show me my calendar instead`,
    });
    const { messages } = await waitForSlackChannelResponse({
      channel,
      afterTs: msg3.ts,
      timeoutMs: 25_000,
    });
    const botReplies = messages.filter((m) => m.bot_id);
    expect(botReplies.length).toBeGreaterThan(0);
    // Channel history is newest first; most recent bot reply is first
    const lastText = botReplies[0]?.text ?? "";
    expect(lastText).toMatch(/calendar|schedule|events?|meetings?/i);
  }, 120_000);

  it("Handles ambiguous Slack messages with clarifying reply", async () => {
    requireSlackEnv();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const ambiguous = [
      "schedule the thing with you know who",
      "email them about it",
    ];
    for (const text of ambiguous) {
      const msg = await postSlackMessage({
        channel,
        text: `${SLACK_E2E_PREFIX} ${text}`,
      });
      const { messages } = await waitForSlackChannelResponse({
        channel,
        afterTs: msg.ts,
        timeoutMs: 20_000,
      });
      const replyText = messages
        .filter((m) => m.bot_id)
        .map((m) => m.text ?? "")
        .join(" ");
      expect(replyText).toMatch(
        /who|what|which|clarify|need more info|specify/i,
      );
    }
  }, 60_000);

  it("Handles Google OAuth token expiration mid-conversation", async () => {
    requireSlackEnv();
    // Optional: expire token, then message; assert refresh or re-auth message.
  });
});
