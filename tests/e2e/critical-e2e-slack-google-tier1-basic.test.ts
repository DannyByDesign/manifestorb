/**
 * Slack ↔ Main App ↔ Google E2E — Tier 1: Basic three-way communication.
 * Run with: RUN_LIVE_SLACK_GOOGLE_E2E=true vitest run --config vitest.e2e.config.ts tests/e2e/critical-e2e-slack-google-tier1-basic.test.ts
 *
 * Requires: SURFACES_SHARED_SECRET, and for simulated tests the main app must be running (or use in-process).
 * For full round-trip: SLACK_BOT_TOKEN, TEST_SLACK_CHANNEL_ID, TEST_SLACK_USER_ID; main app + sidecar running.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  simulateInboundSlackMessage,
  requireSlackEnv,
  postSlackMessage,
  waitForSlackChannelResponse,
  getSlackThreadReplies,
  getSlackChannelHistory,
  wait,
  SLACK_E2E_PREFIX,
} from "./slack-google-e2e-harness";

vi.mock("server-only", () => ({}));

const describeSlackGoogle = describe.runIf(
  process.env.RUN_LIVE_SLACK_GOOGLE_E2E === "true",
);

describeSlackGoogle("Slack–Google E2E Tier 1: Basic communication", () => {
  beforeEach(async () => {
    await wait(15000);
  });

  it("Message round-trip (simulated): Slack → Main App → response", async () => {
    const channelId = process.env.TEST_SLACK_CHANNEL_ID ?? "C00000000";
    const userId = process.env.TEST_SLACK_USER_ID ?? "U00000000";
    const messageId = `e2e-${Date.now()}`;

    const { responses } = await simulateInboundSlackMessage({
      content: "What's on my calendar today?",
      channelId,
      userId,
      messageId,
    });

    expect(responses.length).toBeGreaterThanOrEqual(1);
    const text = responses.map((r) => r.content ?? "").join(" ");
    // Accept calendar keywords or calendar-style output (e.g. "Today, ... you have:" with time ranges)
    expect(text).toMatch(
      /calendar|events?|meetings?|free|schedule|Today.*you have|:\d{1,2}\s*(?:AM|PM)\s*-\s*\d{1,2}\s*(?:AM|PM)/i
    );
  }, 30_000);

  it("Message round-trip (full): post to Slack, sidecar forwards, response in channel", async () => {
    requireSlackEnv();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const msg = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} What's on my calendar today?`,
    });

    const { messages } = await waitForSlackChannelResponse({
      channel,
      afterTs: msg.ts,
      timeoutMs: 30_000,
    });

    expect(messages.length).toBeGreaterThan(1);
    const botReplies = messages.filter((m) => m.bot_id && m.ts !== msg.ts);
    expect(botReplies.length).toBeGreaterThanOrEqual(1);
    const replyText = botReplies.map((r) => r.text ?? "").join(" ");
    expect(replyText).toMatch(/calendar|events?|meetings?|free|schedule/i);
  }, 45_000);

  it.skip("Proactive message: Main App sends to Slack after urgent email", async () => {
    // Push to Slack on urgent email is not implemented. When we add it (e.g. from email
    // webhook/history handler → ChannelRouter.pushMessage), implement: loadLiveContext(),
    // sendInboundEmail(ctx, { subject: "[URGENT] Server down", ... }), wait(5000),
    // getSlackChannelHistory, assert message contains URGENT or "Server down".
    requireSlackEnv();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const { messages } = await getSlackChannelHistory({ channel, limit: 5 });
    const urgent = messages.find(
      (m) => m.text?.includes("URGENT") || m.text?.includes("Server down"),
    );
    expect(urgent).toBeTruthy();
  }, 15_000);
});
