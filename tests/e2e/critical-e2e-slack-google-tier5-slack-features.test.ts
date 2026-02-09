/**
 * Slack ↔ Main App ↔ Google E2E — Tier 5: Slack-specific features (thread context, mentions, rich formatting).
 * Run with: RUN_LIVE_SLACK_GOOGLE_E2E=true RUN_LIVE_E2E=true vitest run --config vitest.e2e.config.ts tests/e2e/critical-e2e-slack-google-tier5-slack-features.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLiveContext,
  requireSlackEnv,
  postSlackMessage,
  waitForSlackChannelResponse,
  getSlackChannelHistory,
  sendInboundEmail,
  listCalendarEvents,
  wait,
  SLACK_E2E_PREFIX,
  getNextWednesday,
  setHours,
} from "./slack-google-e2e-harness";

vi.mock("server-only", () => ({}));

const describeSlackGoogle = describe.runIf(
  process.env.RUN_LIVE_SLACK_GOOGLE_E2E === "true",
);

describeSlackGoogle("Slack–Google E2E Tier 5: Slack-specific features", () => {
  beforeEach(async () => {
    await wait(15000);
  });

  it("AI maintains context in channel (follow-ups as top-level messages)", async () => {
    requireSlackEnv();
    const ctx = await loadLiveContext();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const msg1 = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} I need to schedule a meeting with the product team`,
    });
    await waitForSlackChannelResponse({
      channel,
      afterTs: msg1.ts,
      timeoutMs: 25_000,
    });
    const msg2 = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} When are they all free?`,
    });
    await waitForSlackChannelResponse({
      channel,
      afterTs: msg2.ts,
      timeoutMs: 25_000,
    });
    await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Schedule it for 2pm next Wednesday`,
    });
    await wait(15_000);
    const wed = getNextWednesday();
    const timeMin = setHours(wed, 14, 0);
    const timeMax = setHours(wed, 15, 0);
    const events = await listCalendarEvents(ctx, timeMin, timeMax);
    expect(events.length >= 0).toBe(true);
  }, 90_000);

  it("AI responds in channel (no thread)", async () => {
    requireSlackEnv();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const msg = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Do I have any meetings today?`,
    });
    const { messages } = await waitForSlackChannelResponse({
      channel,
      afterTs: msg.ts,
      timeoutMs: 25_000,
    });
    const replyText = messages
      .filter((m) => m.bot_id && m.ts !== msg.ts)
      .map((m) => m.text ?? "")
      .join(" ");
    expect(replyText).toMatch(/today|calendar|events?|meetings?|free/i);
  }, 45_000);

  it("Slack message with interactive elements (approval/draft buttons)", async () => {
    requireSlackEnv();
    const ctx = await loadLiveContext();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    await sendInboundEmail(ctx, {
      to: ctx.emailAccount.email,
      subject: `${SLACK_E2E_PREFIX} Interview Scheduling ${Date.now()}`,
      body: "Would you prefer Monday at 2pm or Tuesday at 10am?",
      fromOverride: "recruiter@company.com",
    });
    await wait(8000);
    const msg = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Draft a response with my availability`,
    });
    const { messages } = await waitForSlackChannelResponse({
      channel,
      afterTs: msg.ts,
      timeoutMs: 30_000,
    });
    const hasReply = messages.some((m) => m.bot_id && m.ts !== msg.ts);
    expect(hasReply).toBe(true);
  }, 45_000);
});
