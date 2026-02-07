/**
 * Critical E2E Tier 3: Edge Cases (Things That Will Happen Eventually)
 * Real Google account, real API calls, no mocks.
 * Run with: RUN_LIVE_E2E=true bunx vitest --run src/__tests__/e2e/critical-e2e-tier3-edge.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import {
  loadLiveContext,
  sendMessage,
  sendInboundEmail,
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  wait,
} from "./critical-e2e-harness";

vi.mock("server-only", () => ({}));

const describeLive = describe.runIf(process.env.RUN_LIVE_E2E === "true");

const E2E_PREFIX = "[E2E Tier3]";

describeLive("Critical E2E Tier 3: Edge Cases", () => {
  it(
    "Test 9: Attachment handling",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} Contract review ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Can you review this contract and let me know if the dates work with your schedule?",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "What's in my inbox?");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(
        ctx,
        "Check if those dates conflict with my calendar",
      );
      expect(r2.text.length).toBeGreaterThan(0);
    },
  );

  it(
    "Test 10: Last-minute cancellation cascade",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const now = new Date();
      const base = new Date(now);
      base.setHours(14, 0, 0, 0);
      const events: string[] = [];
      for (let i = 0; i < 3; i++) {
        const start = new Date(base.getTime() + i * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        const created = await createCalendarEvent(ctx, {
          title: `${E2E_PREFIX} Meeting ${i + 1} ${Date.now()}`,
          start,
          end,
          description: "E2E_TEST_EVENT",
        });
        events.push(created.id);
      }

      const subject = `${E2E_PREFIX} Cancel 3pm ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Need to cancel our 3pm - family emergency",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "Handle this cancellation");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(ctx, "No, leave it");
      expect(r2.text.length).toBeGreaterThan(0);

      for (const id of events) {
        await deleteCalendarEvent(ctx, id, { mode: "single" });
      }
    },
  );

  it(
    "Test 11: Out-of-office auto-response",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} Meet Thursday ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Can we meet next Thursday?",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "What needs my attention?");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(ctx, "Yes, suggest the following week");
      expect(r2.text.length).toBeGreaterThan(0);
    },
  );

  it(
    "Test 12: Double-booking catch",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const now = new Date();
      const nextTuesday = new Date(now);
      const dayOfWeek = nextTuesday.getDay();
      const daysUntilTuesday = dayOfWeek <= 2 ? 2 - dayOfWeek + (dayOfWeek === 2 ? 7 : 0) : 9 - dayOfWeek;
      nextTuesday.setDate(nextTuesday.getDate() + daysUntilTuesday);
      nextTuesday.setHours(14, 0, 0, 0);
      const end = new Date(nextTuesday.getTime() + 60 * 60 * 1000);

      const created = await createCalendarEvent(ctx, {
        title: `${E2E_PREFIX} Existing 2pm ${Date.now()}`,
        start: nextTuesday,
        end,
        description: "E2E_TEST_EVENT",
      });

      const subject = `${E2E_PREFIX} Tuesday 2pm ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Let's meet Tuesday at 2pm",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "Accept this meeting");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(ctx, "Decline the new one");
      expect(r2.text.length).toBeGreaterThan(0);

      await deleteCalendarEvent(ctx, created.id, { mode: "single" });
    },
  );

  it(
    "Test 13: VIP never responds to invites",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const r1 = await sendMessage(
        ctx,
        "Is my meeting with CEO confirmed?",
      );
      expect(r1.text.length).toBeGreaterThan(0);
    },
  );

  it(
    "Test 14: Rapid-fire inbox triage",
    { timeout: 150_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} Triage ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Urgent: need your sign-off by EOD",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "What needs my attention?");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(ctx, "Draft response");
      expect(r2.text.length).toBeGreaterThan(0);
    },
  );

  it(
    "Test 15: The wait I changed my mind test",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} Friday 3pm ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Can we meet Friday at 3pm?",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "Accept this and create the meeting");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(
        ctx,
        "Wait, actually check if I have anything after 4pm that day first",
      );
      expect(r2.text.length).toBeGreaterThan(0);

      const r3 = await sendMessage(
        ctx,
        "Okay, never mind the meeting, I'm too packed",
      );
      expect(r3.text.length).toBeGreaterThan(0);

      const now = new Date();
      const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const events = await listCalendarEvents(ctx, now, weekEnd, E2E_PREFIX);
      const friday3pm = events.filter(
        (e) =>
          e.title?.includes("Friday 3pm") || e.title?.includes("Friday"),
      );
      expect(friday3pm.length).toBe(0);
    },
  );
});
