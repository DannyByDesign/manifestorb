/**
 * "Nothing else matters" E2E test: full flow as intended for the product.
 *
 * Two tests:
 * 1. Plumbing: read email → availability → propose 3 times → pick one → create event with Meet → send confirmation (no AI).
 * 2. Full AI (Option A): runOneShotAgent with meeting request → assert schedule proposal → resolve with "1" → assert event with Meet link.
 *
 * Run with: RUN_LIVE_E2E=true bunx vitest --run src/__tests__/e2e/nothing-else-matters.test.ts
 * Optional: LIVE_E2E_SKIP_CLEANUP=true to leave the event on the calendar.
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
import { GoogleCalendarEventProvider } from "@/features/calendar/providers/google-events";
import { createGoogleAvailabilityProvider } from "@/server/features/calendar/providers/google-availability";
import { sendEmailWithHtml } from "@/server/integrations/google/mail";
import prisma from "@/server/db/client";
import {
  getPendingScheduleProposal,
  resolveScheduleProposalRequestById,
  type ScheduleProposalPayload,
} from "@/features/calendar/schedule-proposal";
import { processHistoryItem } from "@/features/webhooks/process-history-item";
import { createEmailProvider } from "@/features/email/provider";
import { getAssistantEmail } from "@/features/web-chat/is-assistant-email";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";

vi.mock("server-only", () => ({}));
vi.unmock("@/server/db/client");

const describeLive = describe.runIf(process.env.RUN_LIVE_E2E === "true");

/** Future slot: from + dayOffset days, at 14:00 UTC, 30 min duration. */
function proposalSlot(
  from: Date,
  dayOffset: number,
): { start: Date; end: Date } {
  const start = new Date(from);
  start.setUTCDate(start.getUTCDate() + dayOffset);
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { start, end };
}

describeLive("nothing else matters (full E2E)", () => {
  it("read email → availability → propose 3 times → pick one → create event with Meet → send confirmation", async () => {
    const required = [
      "LIVE_EMAIL_ACCOUNT_ID",
      "LIVE_GOOGLE_ACCESS_TOKEN",
      "LIVE_GOOGLE_REFRESH_TOKEN",
      "LIVE_GOOGLE_EMAIL",
      "LIVE_GMAIL_QUERY",
      "LIVE_GMAIL_RECIPIENT",
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
    const query = process.env.LIVE_GMAIL_QUERY ?? "in:inbox";
    const recipient = process.env.LIVE_GMAIL_RECIPIENT ?? userEmail;

    const calAccessToken =
      process.env.LIVE_CALENDAR_ACCESS_TOKEN ?? accessToken;
    const calRefreshToken =
      process.env.LIVE_CALENDAR_REFRESH_TOKEN ?? refreshToken;

    // --- 1. Read email (meeting request context) ---
    const gmail = await getGmailClientWithRefresh({
      accessToken,
      refreshToken,
      expiresAt: null,
      emailAccountId,
      logger,
    });
    const gmailProvider = new GmailProvider(gmail, emailAccountId, logger);

    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 1,
    });
    const messageId = listResponse.data.messages?.[0]?.id;
    expect(messageId).toBeTruthy();

    const message = await gmailProvider.getMessage(messageId ?? "");
    expect(message.threadId).toBeTruthy();
    expect(message.headers.to?.includes(userEmail)).toBe(true);

    const thread = await gmailProvider.getThread(message.threadId);
    expect(thread.messages.length).toBeGreaterThan(0);

    // --- 2. Check calendar availability (next 7 days) ---
    const availabilityProvider = createGoogleAvailabilityProvider(logger);
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() + 1);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(timeMin);
    timeMax.setDate(timeMax.getDate() + 7);

    const busyPeriods = await availabilityProvider.fetchBusyPeriods({
      accessToken: calAccessToken,
      refreshToken: calRefreshToken,
      expiresAt: null,
      emailAccountId,
      calendarIds: [calendarId],
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
    });
    expect(Array.isArray(busyPeriods)).toBe(true);

    // --- 3. Propose three times (next 3 days at 14:00 UTC) ---
    const proposals = [
      proposalSlot(now, 1),
      proposalSlot(now, 2),
      proposalSlot(now, 3),
    ];

    // --- 4. Recipient picks one (we pick the first) ---
    const chosen = proposals[0];
    const title = "Proposal discussion (nothing else matters E2E)";

    // --- 5. Create calendar event with Google Meet link ---
    const calendarProvider = new GoogleCalendarEventProvider(
      {
        accessToken: calAccessToken,
        refreshToken: calRefreshToken,
        expiresAt: null,
        emailAccountId,
        userId: emailAccountId,
        timeZone,
      },
      logger,
    );

    let createdEventId: string | null = null;
    try {
      const event = await calendarProvider.createEvent(calendarId, {
        title,
        start: chosen.start,
        end: chosen.end,
        timeZone,
        addGoogleMeet: true,
      });
      createdEventId = event.id;
      expect(event.id).toBeTruthy();
      expect(event.videoConferenceLink).toBeTruthy();
      expect(event.videoConferenceLink).toMatch(/meet\.google\.com/);

      logger.info("Calendar event created with Meet link", {
        eventId: event.id,
        calendarId,
        title,
        videoConferenceLink: event.videoConferenceLink,
      });

      // --- 6. Send confirmation email in thread ---
      const startIso = chosen.start.toISOString();
      await sendEmailWithHtml(gmail, {
        to: recipient,
        subject: `Re: Confirmed – ${title}`,
        messageHtml: `<p>Confirmed. We're scheduled for ${startIso}. Join here: <a href="${event.videoConferenceLink}">${event.videoConferenceLink}</a></p>`,
        replyToEmail: {
          threadId: thread.id,
          headerMessageId: message.headers["message-id"] ?? "",
          references: message.headers.references,
        },
      });
    } finally {
      const skipCleanup = process.env.LIVE_E2E_SKIP_CLEANUP === "true";
      if (createdEventId && !skipCleanup) {
        await calendarProvider.deleteEvent(calendarId, createdEventId, {
          mode: "single",
        });
      }
    }
  });

  it("full AI: email arrives → AI finds open slots → proposes 3 → user picks one → event with Meet → confirmation email", async () => {
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

    const logger = createScopedLogger("nothing-else-matters-ai");
    const emailAccountId = process.env.LIVE_EMAIL_ACCOUNT_ID ?? "";
    const accessToken = process.env.LIVE_GOOGLE_ACCESS_TOKEN ?? "";
    const refreshToken = process.env.LIVE_GOOGLE_REFRESH_TOKEN ?? "";
    const calendarId = process.env.LIVE_GOOGLE_CALENDAR_ID ?? "primary";
    const timeZone = process.env.LIVE_GOOGLE_TIME_ZONE ?? "UTC";
    const userEmail = process.env.LIVE_GOOGLE_EMAIL ?? "";
    const calAccessToken =
      process.env.LIVE_CALENDAR_ACCESS_TOKEN ?? accessToken;
    const calRefreshToken =
      process.env.LIVE_CALENDAR_REFRESH_TOKEN ?? refreshToken;

    // Real Gmail client – no mocks
    const gmail = await getGmailClientWithRefresh({
      accessToken,
      refreshToken,
      expiresAt: null,
      emailAccountId,
      logger,
    });
    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider: "google",
      logger,
    });

    // Setup calendar connection (real calendar for finding open slots)
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

    // Email account for pipeline (same shape as process-assistant-email)
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
    const emailAccount = {
      ...emailAccountRow,
      autoCategorizeSenders: emailAccountRow.autoCategorizeSenders ?? false,
      filingEnabled: emailAccountRow.filingEnabled ?? false,
      filingPrompt: emailAccountRow.filingPrompt ?? null,
    } as unknown as EmailAccountWithAI & {
      autoCategorizeSenders: boolean;
      filingEnabled: boolean;
      filingPrompt: string | null;
      email: string;
    };
    const rules = await prisma.rule.findMany({
      where: { emailAccountId },
      include: {
        actions: true,
        group: { include: { items: true } },
      },
    });
    const assistantEmail = getAssistantEmail({ userEmail });

    // --- 1. Send real email to assistant (starts real thread in Gmail) ---
    const sendResult1 = await sendEmailWithHtml(gmail, {
      to: assistantEmail,
      subject: "Meeting request (E2E)",
      messageHtml: "<p>Can we meet next week to discuss the proposal?</p>",
    });
    const firstMessageId = sendResult1.data.id ?? undefined;
    const threadId = sendResult1.data.threadId ?? undefined;
    expect(firstMessageId).toBeTruthy();
    expect(threadId).toBeTruthy();

    // --- 2. Run full pipeline (no pre-built message: it fetches from Gmail) ---
    await processHistoryItem(
      { messageId: firstMessageId!, threadId: threadId! },
      {
        provider: emailProvider,
        emailAccount,
        rules: rules as any,
        hasAutomationRules: rules.length > 0,
        hasAiAccess: true,
        logger,
      },
    );

    // --- 3. Assert: schedule proposal created with 3 options from real slot finding ---
    const pendingProposal = await getPendingScheduleProposal(user.id);
    expect(
      pendingProposal,
      "Expected a pending schedule proposal after first pipeline run"
    ).toBeTruthy();
    const payload = pendingProposal!.requestPayload as ScheduleProposalPayload;
    expect(payload.actionType).toBe("schedule_proposal");
    expect(Array.isArray(payload.options)).toBe(true);
    expect(payload.options.length).toBe(3);

    // Assert the 3 options are real open slots: in the future, within 14 days, distinct
    const now = Date.now();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const slotStarts = payload.options.map((o) => new Date(o.start).getTime());
    for (const t of slotStarts) {
      expect(t).toBeGreaterThanOrEqual(now);
      expect(t).toBeLessThanOrEqual(now + fourteenDaysMs);
    }
    const uniqueStarts = new Set(slotStarts);
    expect(uniqueStarts.size).toBe(3);

    // --- 4. Get thread from Gmail; last message is AI proposal reply ---
    const gmailProvider = new GmailProvider(gmail, emailAccountId, logger);
    const threadMessages = await gmailProvider.getThreadMessages(threadId!);
    expect(threadMessages.length).toBeGreaterThanOrEqual(2);
    const aiProposalMessage = threadMessages[threadMessages.length - 1];
    const proposalBody = (aiProposalMessage.textPlain ?? "") + (aiProposalMessage.textHtml ?? "");
    expect(proposalBody).toMatch(/1\)/);
    expect(proposalBody).toMatch(/2\)/);
    expect(proposalBody).toMatch(/3\)/);
    expect(proposalBody).toMatch(/Reply 1, 2, or 3/i);

    // --- 5. Mock user picking: resolve with choice 0 (same as user replying "1").
    //      If anything above failed, we never get here (early failure). ---
    const resolveResult = await resolveScheduleProposalRequestById({
      requestId: pendingProposal!.id,
      choiceIndex: 0,
      userId: user.id,
    });
    expect(resolveResult.ok).toBe(true);
    const execData = resolveResult.ok ? resolveResult.data : null;
    const event = execData && typeof execData === "object" && "data" in execData ? (execData as { data?: { id?: string; videoConferenceLink?: string } }).data : null;
    expect(event).toBeTruthy();
    expect(typeof event?.id).toBe("string");
    expect(event?.videoConferenceLink).toBeTruthy();
    expect(event?.videoConferenceLink).toMatch(/meet\.google\.com/);

    const remainingProposal = await getPendingScheduleProposal(user.id);
    expect(remainingProposal).toBeNull();

    // No cleanup: event remains on calendar for manual verification.
  });
});
