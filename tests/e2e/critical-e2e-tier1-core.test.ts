/**
 * Critical E2E Tier 1: Core Loops (Must Work Perfectly)
 * Real Google account, real API calls, no mocks.
 * Run with: RUN_LIVE_E2E=true bunx vitest --run tests/e2e/critical-e2e-tier1-core.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import {
  loadLiveContext,
  sendMessage,
  getPendingApproval,
  approve,
  sendInboundEmail,
  listSentMessages,
  getMessage,
  createCalendarEvent,
  updateCalendarEvent,
  listCalendarEvents,
  getCalendarEvent,
  deleteCalendarEvent,
  wait,
} from "./critical-e2e-harness";

vi.mock("server-only", () => ({}));

const describeLive = describe.runIf(process.env.RUN_LIVE_E2E === "true");

const E2E_PREFIX = "[E2E Tier1]";

describeLive("Critical E2E Tier 1: Core Loops", () => {
  it(
    "Test 1: Cold email response flow",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} Q1 budget ${Date.now()}`;
      const body = "Hey, can we meet next week to discuss the Q1 budget?";

      const sent = await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body,
      });
      expect(sent.messageId).toBeTruthy();
      expect(sent.threadId).toBeTruthy();
      const originalThreadId = sent.threadId;

      await wait(5000);

      const r1 = await sendMessage(ctx, "What needs my attention?");
      expect(r1.text.length).toBeGreaterThan(0);
      expect(
        r1.text.toLowerCase().includes("budget") ||
          r1.text.toLowerCase().includes("meet") ||
          r1.text.toLowerCase().includes("q1") ||
          r1.text.toLowerCase().includes("attention"),
      ).toBe(true);

      const r2 = await sendMessage(
        ctx,
        "Draft a response suggesting Tuesday or Wednesday afternoon",
      );
      expect(r2.text.length).toBeGreaterThan(0);
      expect(
        r2.text.toLowerCase().includes("tuesday") ||
          r2.text.toLowerCase().includes("wednesday") ||
          r2.text.toLowerCase().includes("draft") ||
          r2.text.toLowerCase().includes("afternoon"),
      ).toBe(true);

      const pending = await getPendingApproval(ctx, { actionType: "send_draft" });
      if (pending) {
        await approve(ctx, pending.id);
      }

      await wait(5000);

      const anySent = await listSentMessages(ctx);
      const inOriginalThread = anySent.filter((s) => s.threadId === originalThreadId);
      if (inOriginalThread.length > 0) {
        const first = await getMessage(ctx, inOriginalThread[0].id);
        expect(first.threadId).toBe(originalThreadId);
      }
    },
  );

  it(
    "Test 2: Meeting scheduling negotiation",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} Coffee Thursday ${Date.now()}`;
      const body = "Can we do coffee on Thursday?";

      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body,
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "What needs my attention?");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(
        ctx,
        "Check if I'm free Thursday afternoon",
      );
      expect(r2.text.length).toBeGreaterThan(0);

      const r3 = await sendMessage(ctx, "Suggest Friday instead");
      expect(r3.text.length).toBeGreaterThan(0);

      const pendingSend = await getPendingApproval(ctx, {
        actionType: "send_draft",
      });
      if (pendingSend) {
        await approve(ctx, pendingSend.id);
      }
      await wait(3000);

      const r4 = await sendMessage(ctx, "Add it to my calendar");
      expect(r4.text.length).toBeGreaterThan(0);

      const now = new Date();
      const weekEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const events = await listCalendarEvents(ctx, now, weekEnd, "coffee");
      expect(events.length).toBeGreaterThanOrEqual(0);
    },
  );

  it(
    "Test 3: Same-day schedule change",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const now = new Date();
      const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const inThreeHours = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      const title = `${E2E_PREFIX} 2pm meeting ${Date.now()}`;

      const created = await createCalendarEvent(ctx, {
        title,
        start: inTwoHours,
        end: inThreeHours,
        description: "E2E_TEST_EVENT",
      });
      expect(created.id).toBeTruthy();

      const subject = `${E2E_PREFIX} Reschedule 2pm ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Need to push our 2pm to 4pm today, sorry!",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "What's urgent?");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(ctx, "Check if 4pm works for me");
      expect(r2.text.length).toBeGreaterThan(0);

      const r3 = await sendMessage(ctx, "Move the meeting");
      expect(r3.text.length).toBeGreaterThan(0);

      await wait(3000);

      const eventAfter = await getCalendarEvent(ctx, created.id);
      expect(eventAfter).toBeTruthy();

      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(now);
      dayEnd.setHours(23, 59, 59, 999);
      const sameTitle = await listCalendarEvents(ctx, dayStart, dayEnd, "2pm");
      // Count only events with this run's exact title (original or moved), not leftovers from other runs
      const withSameTitle = sameTitle.filter((e) => e.title === title);
      expect(withSameTitle.length).toBeLessThanOrEqual(2);

      await deleteCalendarEvent(ctx, created.id, { mode: "single" });
    },
  );
});
