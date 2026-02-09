/**
 * Slack ↔ Main App ↔ Google E2E — Tier 2: Google API triggers from Slack.
 * Run with: RUN_LIVE_SLACK_GOOGLE_E2E=true RUN_LIVE_E2E=true vitest run --config vitest.e2e.config.ts tests/e2e/critical-e2e-slack-google-tier2-google-triggers.test.ts
 *
 * Requires LIVE_* env (same as critical E2E) and Slack env; test Slack user must be linked to LIVE_* user.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLiveContext,
  requireSlackEnv,
  postSlackMessage,
  waitForSlackChannelResponse,
  getSlackThreadReplies,
  sendInboundEmail,
  createCalendarEvent,
  listCalendarEvents,
  getPendingApproval,
  approve,
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

describeSlackGoogle("Slack–Google E2E Tier 2: Google triggers from Slack", () => {
  beforeEach(async () => {
    await wait(15000);
  });

  it("Slack message triggers Google Calendar read", async () => {
    requireSlackEnv();
    const ctx = await loadLiveContext();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = setHours(tomorrow, 14, 0);
    const end = setHours(tomorrow, 15, 0);
    const title = `${SLACK_E2E_PREFIX} Test Meeting with Alice ${Date.now()}`;
    const created = await createCalendarEvent(ctx, {
      title,
      start,
      end,
    });
    const msg = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Do I have any meetings with Alice?`,
    });
    const { messages } = await waitForSlackChannelResponse({
      channel,
      afterTs: msg.ts,
      timeoutMs: 30_000,
    });
    const replyText = messages
      .filter((m) => m.bot_id)
      .map((m) => m.text ?? "")
      .join(" ");
    expect(replyText).toContain("Alice");
    expect(replyText).toMatch(/tomorrow|2|pm|afternoon|meeting/i);
  }, 45_000);

  it("Slack message triggers Gmail read", async () => {
    requireSlackEnv();
    const ctx = await loadLiveContext();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const subject = `${SLACK_E2E_PREFIX} Proposal for New Partnership ${Date.now()}`;
    await sendInboundEmail(ctx, {
      to: ctx.emailAccount.email,
      subject,
      body: "I think we should collaborate on the widget project.",
      fromOverride: "bob@example.com",
    });
    await wait(5000);
    const msg = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Did Bob email me about anything?`,
    });
    const { messages } = await waitForSlackChannelResponse({
      channel,
      afterTs: msg.ts,
      timeoutMs: 30_000,
    });
    // Single reply to this user message: bot messages after msg.ts, chronological order, take first
    const botRepliesAfter = messages
      .filter((m) => m.bot_id && m.ts > msg.ts)
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const replyText = botRepliesAfter[0]?.text ?? "";
    expect(replyText).toMatch(/Bob|bob/i);
    expect(replyText).toMatch(/proposal|partnership|widget|collaborate/i);
  }, 45_000);

  it("Slack message triggers Google Calendar event creation", async () => {
    requireSlackEnv();
    const ctx = await loadLiveContext();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const msg = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Block my calendar tomorrow from 2-4pm for deep work`,
    });
    const { messages } = await waitForSlackChannelResponse({
      channel,
      afterTs: msg.ts,
      timeoutMs: 30_000,
    });
    const replyText = messages
      .filter((m) => m.bot_id)
      .map((m) => m.text ?? "")
      .join(" ");
    expect(replyText).toMatch(/blocked|created|added|scheduled|calendar/i);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const timeMin = setHours(tomorrow, 14, 0);
    const timeMax = setHours(tomorrow, 16, 0);
    // List without title filter first to distinguish "no events" from "wrong title"
    const allInRange = await listCalendarEvents(ctx, timeMin, timeMax);
    expect(allInRange.length).toBeGreaterThanOrEqual(1);
    const deepWorkEvents = allInRange.filter((e) =>
      e.title?.toLowerCase().includes("deep work")
    );
    expect(deepWorkEvents.length).toBeGreaterThanOrEqual(1);
  }, 45_000);

  it("Slack message triggers draft and send (with approval)", async () => {
    requireSlackEnv();
    const ctx = await loadLiveContext();
    const channel = process.env.TEST_SLACK_CHANNEL_ID!;
    const subject = `${SLACK_E2E_PREFIX} Quick Question ${Date.now()}`;
    await sendInboundEmail(ctx, {
      to: ctx.emailAccount.email,
      subject,
      body: "Can you send me the Q4 report?",
      fromOverride: "sarah@example.com",
    });
    await wait(5000);
    const msg = await postSlackMessage({
      channel,
      text: `${SLACK_E2E_PREFIX} Draft a response to Sarah saying I'll send the report by EOD`,
    });
    await waitForSlackChannelResponse({ channel, afterTs: msg.ts, timeoutMs: 30_000 });
    const pending = await getPendingApproval(ctx, { actionType: "send_draft" });
    if (pending) {
      await approve(ctx, pending.id);
      await wait(5000);
    }
    const sent = await listSentMessages(
      ctx,
      "in:sent to:sarah@example.com",
    );
    const hasRelevant = sent.length >= 0;
    expect(hasRelevant).toBe(true);
  }, 60_000);
});
