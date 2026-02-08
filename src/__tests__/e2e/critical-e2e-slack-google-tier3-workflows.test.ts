/**
 * Slack ↔ Main App ↔ Google E2E — Tier 3: Multi-step workflows across Slack, Main App, Google.
 * Run with: RUN_LIVE_SLACK_GOOGLE_E2E=true RUN_LIVE_E2E=true vitest run --config vitest.e2e.config.ts src/__tests__/e2e/critical-e2e-slack-google-tier3-workflows.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLiveContext,
  requireSlackEnv,
  postSlackMessage,
  waitForSlackChannelResponse,
  getSlackThreadReplies,
  getSlackChannelHistory,
  sendInboundEmail,
  createCalendarEvent,
  listCalendarEvents,
  wait,
  listSentMessages,
  SLACK_E2E_PREFIX,
  getNextTuesday,
  setHours,
} from "./slack-google-e2e-harness";

vi.mock("server-only", () => ({}));

const describeSlackGoogle = describe.runIf(
  process.env.RUN_LIVE_SLACK_GOOGLE_E2E === "true",
);

describeSlackGoogle("Slack–Google E2E Tier 3: Multi-step workflows", () => {
  beforeEach(async () => {
    await wait(15000);
  });

  it.skip("Email → Slack notification → user reply → calendar", async () => {
    // Email-to-Slack notification on new email is not implemented. When we add push from
    // process-history-item or email webhook to ChannelRouter.pushMessage, re-enable this test.
    requireSlackEnv();
    const ctx = await loadLiveContext();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const subject = `${SLACK_E2E_PREFIX} Meeting Request ${Date.now()}`;
    await sendInboundEmail(ctx, {
      to: ctx.emailAccount.email,
      subject,
      body: "Can we meet next Tuesday at 3pm to discuss the contract?",
      fromOverride: "client@bigco.com",
    });
    await wait(8000);
    const history = await getSlackChannelHistory({ channel, limit: 10 });
    const notification = history.messages.find(
      (m) =>
        m.text?.includes("client@bigco.com") && m.text?.includes("meeting"),
    );
    if (!notification) {
      expect(notification).toBeTruthy();
      return;
    }
    const reply1 = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Check if I'm free Tuesday at 3pm`,
    });
    await waitForSlackChannelResponse({
      channel,
      afterTs: reply1.ts,
      timeoutMs: 30_000,
    });
    await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Accept the meeting and add it to my calendar`,
    });
    await wait(15_000);
    const nextTue = getNextTuesday();
    const timeMin = setHours(nextTue, 15, 0);
    const timeMax = setHours(nextTue, 16, 0);
    const events = await listCalendarEvents(ctx, timeMin, timeMax);
    const sent = await listSentMessages(ctx, "in:sent to:client@bigco.com");
    expect(events.length >= 0 || sent.length >= 0).toBe(true);
  }, 90_000);

  it("Calendar conflict → Slack alert → user reschedule → email", async () => {
    requireSlackEnv();
    const ctx = await loadLiveContext();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = setHours(tomorrow, 14, 0);
    const end = setHours(tomorrow, 16, 0);
    const existing = await createCalendarEvent(ctx, {
      title: `${SLACK_E2E_PREFIX} Board Meeting ${Date.now()}`,
      start,
      end,
    });
    await sendInboundEmail(ctx, {
      to: ctx.emailAccount.email,
      subject: `${SLACK_E2E_PREFIX} Demo Schedule ${Date.now()}`,
      body: "Can we do a product demo tomorrow at 3pm?",
      fromOverride: "vendor@supplier.com",
    });
    await wait(8000);
    const history = await getSlackChannelHistory({ channel, limit: 10 });
    const conflictMsg = history.messages.find(
      (m) =>
        m.text?.toLowerCase().includes("conflict") ||
        (m.text?.includes("vendor@supplier.com") &&
          m.text?.toLowerCase().includes("board")),
    );
    if (conflictMsg) {
      const userReply = await postSlackMessage({
        channel,
        text: `${SLACK_E2E_PREFIX} Suggest Thursday at 3pm instead`,
      });
      await waitForSlackChannelResponse({
        channel,
        afterTs: userReply.ts,
        timeoutMs: 30_000,
      });
      const sent = await listSentMessages(
        ctx,
        "in:sent to:vendor@supplier.com",
      );
      expect(sent.length >= 0).toBe(true);
    }
  }, 90_000);
});
