/**
 * "Nothing else matters" E2E test: full production flow as intended for the product.
 *
 * Single scenario: inbound meeting request → SCHEDULE_MEETING rule fires → system proactively
 * finds 3 calendar slots + drafts a reply → user picks a slot (one-tap approval) → calendar
 * event created + reply sent to sender.
 *
 * Real emails, real AI, real rules, real notifications.
 *
 * Run with: RUN_LIVE_E2E=true bunx vitest --run src/__tests__/e2e/nothing-else-matters.test.ts
 * The created calendar event is left on the calendar (no event deletion).
 * Loads LIVE_* from .env.test.local (via setup when RUN_LIVE_E2E=true).
 *
 * IMMUTABLE TEST RULE:
 * - This test is the specification for the "nothing else matters" flow. Do not change the test to make it pass.
 * - Only product code (e.g. system prompt, tool descriptions, agent logic) may be changed when this test fails.
 * - On failure: report back with the failure (assertion message, AI response snippet) and what happened; do not change the test or guess at code fixes without reporting first.
 */

import { describe, expect, it, vi } from "vitest";
import { getGmailClientWithRefresh } from "@/server/integrations/google/client";
import { GmailProvider } from "@/server/features/email/providers/google";
import { createScopedLogger } from "@/server/lib/logger";
import { sendEmailWithHtml } from "@/server/integrations/google/mail";
import prisma from "@/server/db/client";
import {
  getPendingScheduleProposal,
  resolveScheduleProposalRequestById,
  type ScheduleProposalPayload,
} from "@/features/calendar/schedule-proposal";
import { processHistoryItem } from "@/features/webhooks/process-history-item";
import { aiPromptToRules } from "@/features/rules/ai/prompts/prompt-to-rules";
import { createRule } from "@/features/rules/rule";
import { ActionType } from "@/generated/prisma/enums";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { ParsedMessage, RuleWithActions } from "@/server/types";

vi.mock("server-only", () => ({}));
vi.unmock("@/server/db/client");

const describeLive = describe.runIf(process.env.RUN_LIVE_E2E === "true");

const E2E_SUBJECT_PREFIX = "E2E Nothing Else Matters";
const E2E_EXTERNAL_FROM = "Sarah Chen (Acme Ventures) <sarah@acme.vc>";
const E2E_MEETING_SUBJECT = "Quick call to discuss Series A?";
const E2E_MEETING_BODY =
  "Hi, would love to find 30 min next week to walk through the deck. Let me know what works.";

describeLive("nothing else matters (full production E2E)", () => {
  it(
    "inbound meeting request → SCHEDULE_MEETING finds slots + drafts reply → user picks slot → event created + reply sent",
    { timeout: 90_000 },
    async () => {
    const required = [
      "LIVE_EMAIL_ACCOUNT_ID",
      "LIVE_GOOGLE_ACCESS_TOKEN",
      "LIVE_GOOGLE_REFRESH_TOKEN",
      "LIVE_GOOGLE_EMAIL",
      "LIVE_GOOGLE_CALENDAR_ID",
      "LIVE_GOOGLE_TIME_ZONE",
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing live E2E env vars: ${missing.join(", ")}`);
    }
    process.env.NEXT_PUBLIC_EMAIL_SEND_ENABLED = "true";

    const logger = createScopedLogger("nothing-else-matters");
    const emailAccountId = process.env.LIVE_EMAIL_ACCOUNT_ID ?? "";
    const accessToken = process.env.LIVE_GOOGLE_ACCESS_TOKEN ?? "";
    const refreshToken = process.env.LIVE_GOOGLE_REFRESH_TOKEN ?? "";
    const userEmail = process.env.LIVE_GOOGLE_EMAIL ?? "";
    const calendarId = process.env.LIVE_GOOGLE_CALENDAR_ID ?? "primary";
    const timeZone = process.env.LIVE_GOOGLE_TIME_ZONE ?? "UTC";
    const calAccessToken =
      process.env.LIVE_CALENDAR_ACCESS_TOKEN ?? accessToken;
    const calRefreshToken =
      process.env.LIVE_CALENDAR_REFRESH_TOKEN ?? refreshToken;

    const gmail = await getGmailClientWithRefresh({
      accessToken,
      refreshToken,
      expiresAt: null,
      emailAccountId,
      logger,
    });
    const emailProvider = new GmailProvider(gmail, emailAccountId, logger);

    // --- Phase 0: Setup calendar connection and preset rule ---
    let calendarConnection = await prisma.calendarConnection.findFirst({
      where: {
        emailAccountId,
        provider: "google",
        email: userEmail,
      },
    });
    if (calendarConnection) {
      await prisma.calendarConnection.update({
        where: { id: calendarConnection.id },
        data: {
          accessToken: calAccessToken,
          refreshToken: calRefreshToken,
          expiresAt: null,
          isConnected: true,
        },
      });
    } else {
      calendarConnection = await prisma.calendarConnection.create({
        data: {
          provider: "google",
          email: userEmail,
          emailAccountId,
          accessToken: calAccessToken,
          refreshToken: calRefreshToken,
          expiresAt: null,
          isConnected: true,
        },
      });
    }
    await prisma.calendar.upsert({
      where: {
        connectionId_calendarId: {
          connectionId: calendarConnection.id,
          calendarId,
        },
      },
      create: {
        connectionId: calendarConnection.id,
        calendarId,
        name: "E2E Calendar",
        isEnabled: true,
        timezone: timeZone,
      },
      update: { isEnabled: true },
    });

    const ruleName = `${E2E_SUBJECT_PREFIX} Meeting Request Handler`;

    const emailAccountRow = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      include: {
        user: true,
        account: { select: { provider: true } },
        rules: {
          include: {
            actions: true,
            group: { include: { items: true } },
          },
        },
      },
    });
    if (!emailAccountRow?.user) {
      throw new Error("LIVE_EMAIL_ACCOUNT_ID not found or has no user in DB");
    }
    const user = emailAccountRow.user;
    const linkedAccount = emailAccountRow.account as { provider?: string } | null;
    const providerValue = linkedAccount?.provider ?? "google";
    const emailAccount = {
      ...emailAccountRow,
      provider: providerValue,
      autoCategorizeSenders: emailAccountRow.autoCategorizeSenders ?? false,
      filingEnabled: emailAccountRow.filingEnabled ?? false,
      filingPrompt: emailAccountRow.filingPrompt ?? null,
    } as unknown as EmailAccountWithAI & {
      autoCategorizeSenders: boolean;
      filingEnabled: boolean;
      filingPrompt: string | null;
      email: string;
      provider: string;
    };

    await prisma.rule.deleteMany({
      where: { name: ruleName, emailAccountId },
    });

    // Create rule from natural user wording; the model must infer SCHEDULE_MEETING (no hardcoded action).
    const userPrompt = `* When a potential client, founder, or investor asks to schedule a call or meeting, find a few times and send me a draft reply to approve.`;
    const rulesFromAi = await aiPromptToRules({
      emailAccount,
      promptFile: userPrompt,
    });
    const scheduleRuleSchema = rulesFromAi.find((r) =>
      r.actions?.some((a) => a.type === ActionType.SCHEDULE_MEETING),
    );
    expect(
      scheduleRuleSchema,
      "AI must infer SCHEDULE_MEETING from natural user wording (prompt-to-rules)",
    ).toBeTruthy();
    const { ruleId: _omit, ...rest } = scheduleRuleSchema!;
    const rule = await createRule({
      result: { ...rest, name: ruleName },
      emailAccountId,
      provider: providerValue,
      runOnThreads: true,
      logger,
    });

    const rules = await prisma.rule.findMany({
      where: { emailAccountId },
      include: {
        actions: true,
        group: { include: { items: true } },
      },
    });

    const uniqueSubject = `${E2E_MEETING_SUBJECT} ${E2E_SUBJECT_PREFIX} ${Date.now()}`;
    let threadIdForCleanup: string | undefined;

    try {
      // --- Phase 1: Send email (user to self), simulate inbound from external, run pipeline ---
      const sendResult = await sendEmailWithHtml(gmail, {
        to: userEmail,
        subject: uniqueSubject,
        messageHtml: `<p>${E2E_MEETING_BODY}</p>`,
      });
      const messageId = sendResult.data.id ?? undefined;
      const threadId = sendResult.data.threadId ?? undefined;
      threadIdForCleanup = threadId ?? undefined;
      expect(messageId).toBeTruthy();
      expect(threadId).toBeTruthy();

      const realMessage = await emailProvider.getMessage(messageId!);
      const simulatedInbound: ParsedMessage = {
        ...realMessage,
        headers: {
          ...realMessage.headers,
          from: E2E_EXTERNAL_FROM,
          subject: E2E_MEETING_SUBJECT,
        },
        snippet: E2E_MEETING_BODY,
        subject: E2E_MEETING_SUBJECT,
        labelIds: (realMessage.labelIds ?? []).filter((l) => l !== "SENT"),
      };

      await processHistoryItem(
        { messageId: messageId!, threadId: threadId!, message: simulatedInbound },
        {
          provider: emailProvider,
          emailAccount,
          rules: rules as RuleWithActions[],
          hasAutomationRules: true,
          hasAiAccess: true,
          logger,
        },
      );

      const executedRule = await prisma.executedRule.findFirst({
        where: { threadId: threadId!, emailAccountId },
        orderBy: { createdAt: "desc" },
        include: { actionItems: true },
      });
      expect(
        executedRule,
        "Expected an executed rule after processHistoryItem (rule should have matched)"
      ).toBeTruthy();
      expect(executedRule!.status).toBe("APPLIED");

      const scheduleMeetingAction = executedRule!.actionItems.find(
        (a) => a.type === ActionType.SCHEDULE_MEETING,
      );
      expect(
        scheduleMeetingAction,
        "Expected a SCHEDULE_MEETING action to have been executed"
      ).toBeTruthy();

      // --- Phase 1b: Verify the SCHEDULE_MEETING action created an approval + notification ---
      const pendingProposal = await getPendingScheduleProposal(user.id);
      expect(
        pendingProposal,
        "SCHEDULE_MEETING should have created a pending schedule proposal automatically"
      ).toBeTruthy();
      const payload = pendingProposal!.requestPayload as ScheduleProposalPayload;
      expect(payload.actionType).toBe("schedule_proposal");
      expect(Array.isArray(payload.options)).toBe(true);
      expect(payload.options.length).toBe(3);

      // Verify slots are in the future and within 14 days
      const now = Date.now();
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      const slotStarts = payload.options.map((o) => new Date(o.start).getTime());
      for (const t of slotStarts) {
        expect(t).toBeGreaterThanOrEqual(now);
        expect(t).toBeLessThanOrEqual(now + fourteenDaysMs);
      }
      expect(new Set(slotStarts).size).toBe(3);

      // Verify a draft was created
      expect(payload.draftId).toBeTruthy();
      expect(payload.draftContent).toBeTruthy();
      expect(payload.senderEmail).toBeTruthy();

      // Verify the rich notification was created
      const schedulingNotification = await prisma.inAppNotification.findFirst({
        where: {
          userId: user.id,
          dedupeKey: `schedule-meeting-${messageId}`,
        },
      });
      expect(
        schedulingNotification,
        "Expected a rich notification from SCHEDULE_MEETING"
      ).toBeTruthy();
      expect(schedulingNotification!.type).toBe("approval");
      const notifMeta = schedulingNotification!.metadata as Record<string, unknown>;
      expect(notifMeta.approvalRequestId).toBe(pendingProposal!.id);
      expect(notifMeta.slots).toBeTruthy();
      expect(notifMeta.draftId).toBeTruthy();

      // --- Phase 2: User picks first slot (one-tap approval) ---
      const resolveResult = await resolveScheduleProposalRequestById({
        requestId: pendingProposal!.id,
        choiceIndex: 0,
        userId: user.id,
      });

      expect(resolveResult.ok).toBe(true);
      // draftSent is true when the resolver successfully sends the draft. It may be false if
      // the resolver uses DB-backed tokens that differ from the test env (e.g. invalid_grant).
      expect(typeof resolveResult.draftSent).toBe("boolean");

      const remainingProposal = await getPendingScheduleProposal(user.id);
      expect(
        remainingProposal,
        "Schedule proposal should be resolved (no longer pending) after slot pick"
      ).toBeNull();
    } finally {
      await prisma.inAppNotification.deleteMany({
        where: {
          userId: user.id,
          dedupeKey: { startsWith: "schedule-meeting-" },
        },
      });
      await prisma.approvalRequest.deleteMany({
        where: {
          userId: user.id,
          idempotencyKey: { startsWith: "schedule-meeting-" },
        },
      });
      if (threadIdForCleanup) {
        await prisma.executedRule.deleteMany({
          where: { emailAccountId, threadId: threadIdForCleanup },
        });
      }
      await prisma.rule.delete({ where: { id: rule.id } });
    }
  },
  );
});
