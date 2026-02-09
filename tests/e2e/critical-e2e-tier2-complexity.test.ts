/**
 * Critical E2E Tier 2: Complexity Tests (Real-World Messiness)
 * Real Google account, real API calls, no mocks.
 * Run with: RUN_LIVE_E2E=true bunx vitest --run tests/e2e/critical-e2e-tier2-complexity.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import {
  loadLiveContext,
  sendMessage,
  sendInboundEmail,
  createCalendarEvent,
  deleteCalendarEvent,
  wait,
} from "./critical-e2e-harness";

vi.mock("server-only", () => ({}));

const describeLive = describe.runIf(process.env.RUN_LIVE_E2E === "true");

const E2E_PREFIX = "[E2E Tier2]";

describeLive("Critical E2E Tier 2: Complexity", () => {
  it(
    "Test 4: Long email thread context",
    { timeout: 150_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} Project thread ${Date.now()}`;
      let threadId: string = "";
      for (let i = 0; i < 8; i++) {
        const res = await sendInboundEmail(ctx, {
          to: ctx.emailAccount.email,
          subject: i === 0 ? subject : `Re: ${subject}`,
          body: `Message ${i + 1} in thread about the project.`,
        });
        threadId = res.threadId;
        await wait(1000);
      }
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject: `Re: ${subject}`,
        body: "Actually, can we add Sarah to this meeting?",
      });
      await wait(5000);

      const r1 = await sendMessage(
        ctx,
        `Summarize my thread about ${subject}`,
      );
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(ctx, "Handle the latest request");
      expect(r2.text.length).toBeGreaterThan(0);
      expect(threadId).toBeTruthy();
    },
  );

  it(
    "Test 5: Conflicting requests (rule exception)",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} VIP 9am ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Can we do 9am tomorrow? Only time I have.",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "What needs my attention?");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(
        ctx,
        "Yes, make an exception this once and accept 9am",
      );
      expect(r2.text.length).toBeGreaterThan(0);
    },
  );

  it(
    "Test 6: Multi-party scheduling",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} All 4 of us ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Need to get together - when works for everyone?",
      });
      await wait(5000);

      const r1 = await sendMessage(
        ctx,
        "Find time for all 4 of us next week",
      );
      expect(r1.text.length).toBeGreaterThan(0);
    },
  );

  it(
    "Test 7: Timezone chaos",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const subject = `${E2E_PREFIX} 2pm my time ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Let's meet at 2pm my time on Tuesday",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "Schedule this");
      expect(r1.text.length).toBeGreaterThan(0);
    },
  );

  it(
    "Test 8: Recurring meeting management",
    { timeout: 120_000 },
    async () => {
      const ctx = await loadLiveContext();
      const now = new Date();
      const nextMonday = new Date(now);
      const dayOfWeek = nextMonday.getDay();
      const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
      nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
      nextMonday.setHours(14, 0, 0, 0);
      const endMonday = new Date(nextMonday.getTime() + 60 * 60 * 1000);

      const created = await createCalendarEvent(ctx, {
        title: `${E2E_PREFIX} Weekly 1:1 ${Date.now()}`,
        start: nextMonday,
        end: endMonday,
        description: "E2E_TEST_EVENT recurring",
      });
      expect(created.id).toBeTruthy();

      const subject = `${E2E_PREFIX} Skip 1:1 ${Date.now()}`;
      await sendInboundEmail(ctx, {
        to: ctx.emailAccount.email,
        subject,
        body: "Can we skip next Monday's 1:1? I'm traveling.",
      });
      await wait(5000);

      const r1 = await sendMessage(ctx, "Handle this");
      expect(r1.text.length).toBeGreaterThan(0);

      const r2 = await sendMessage(ctx, "Just next week");
      expect(r2.text.length).toBeGreaterThan(0);

      await deleteCalendarEvent(ctx, created.id, { mode: "single" });
    },
  );
});
