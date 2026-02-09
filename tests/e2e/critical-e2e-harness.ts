/**
 * Shared harness for Critical E2E tests (real Google account, no mocks).
 * Used by critical-e2e-tier1-core.test.ts and other tier files.
 *
 * Requires RUN_LIVE_E2E=true and LIVE_* env vars from .env.test.local.
 */
import { saveTokens } from "@/server/auth";
import { getGmailClientWithRefresh } from "@/server/integrations/google/client";
import { GmailProvider } from "@/server/features/email/providers/google";
import { createScopedLogger } from "@/server/lib/logger";
import { sendEmailWithHtml } from "@/server/integrations/google/mail";
import prisma from "@/server/db/client";
import { ConversationService } from "@/features/conversations/service";
import { runOneShotAgent } from "@/features/channels/executor";
import { executeApprovalRequest } from "@/features/approvals/execute";
import { GoogleCalendarEventProvider } from "@/features/calendar/providers/google-events";
import type { User, EmailAccount } from "@/generated/prisma/client";
import type { Logger } from "@/server/lib/logger";

const REQUIRED_ENV = [
  "LIVE_EMAIL_ACCOUNT_ID",
  "LIVE_GOOGLE_ACCESS_TOKEN",
  "LIVE_GOOGLE_REFRESH_TOKEN",
  "LIVE_GOOGLE_EMAIL",
  "LIVE_GOOGLE_CALENDAR_ID",
  "LIVE_GOOGLE_TIME_ZONE",
] as const;

export interface LiveContext {
  user: User & { emailAccounts: EmailAccount[] };
  emailAccount: EmailAccount;
  conversationId: string;
  gmail: Awaited<ReturnType<typeof getGmailClientWithRefresh>>;
  emailProvider: InstanceType<typeof GmailProvider>;
  calendarProvider: GoogleCalendarEventProvider;
  calendarId: string;
  timeZone: string;
  logger: Logger;
}

/**
 * Load live E2E context: user, email account, Gmail/Calendar clients, conversation ID.
 * Throws if required env vars are missing or DB lookup fails.
 */
export async function loadLiveContext(): Promise<LiveContext> {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing live E2E env vars: ${missing.join(", ")}`);
  }

  process.env.NEXT_PUBLIC_EMAIL_SEND_ENABLED = "true";

  const logger = createScopedLogger("critical-e2e");
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

  // Sync Gmail tokens to DB so the main app (e.g. when handling Slack inbound) uses the same credentials
  await saveTokens({
    emailAccountId,
    tokens: {
      access_token: accessToken || undefined,
      refresh_token: refreshToken || undefined,
    },
    accountRefreshToken: refreshToken,
    provider: "google",
  });

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

  const emailAccountRow = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    include: {
      user: { include: { emailAccounts: true } },
      account: { select: { provider: true } },
    },
  });
  if (!emailAccountRow?.user) {
    throw new Error("LIVE_EMAIL_ACCOUNT_ID not found or has no user in DB");
  }
  const user = emailAccountRow.user as User & { emailAccounts: EmailAccount[] };
  const emailAccount = emailAccountRow as unknown as EmailAccount;

  const conversation = await ConversationService.getPrimaryWebConversation(
    user.id,
  );
  const conversationId = conversation.id;

  const calendarProvider = new GoogleCalendarEventProvider(
    {
      accessToken: calAccessToken,
      refreshToken: calRefreshToken,
      expiresAt: null,
      emailAccountId,
      userId: user.id,
      timeZone,
    },
    logger,
  );

  return {
    user,
    emailAccount,
    conversationId,
    gmail,
    emailProvider,
    calendarProvider,
    calendarId,
    timeZone,
    logger,
  };
}

/**
 * Send a user message to the agent and return the response.
 * Uses the same conversationId for the whole test so history is preserved.
 */
export async function sendMessage(
  ctx: LiveContext,
  text: string,
): Promise<{ text: string; approvals: unknown[] }> {
  const result = await runOneShotAgent({
    user: ctx.user,
    emailAccount: ctx.emailAccount,
    message: text,
    context: {
      conversationId: ctx.conversationId,
      channelId: "web",
      provider: "web",
      userId: ctx.user.id,
    },
  });
  return { text: result.text, approvals: result.approvals ?? [] };
}

/**
 * Get the most recent pending approval for the user (created in the last 60s).
 * Optionally filter by requestPayload.actionType (e.g. "send_draft").
 */
export async function getPendingApproval(
  ctx: LiveContext,
  option?: { actionType?: string },
): Promise<{ id: string } | null> {
  const since = new Date(Date.now() - 60_000);
  const requests = await prisma.approvalRequest.findMany({
    where: {
      userId: ctx.user.id,
      status: "PENDING",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  if (option?.actionType) {
    const match = requests.find((r) => {
      const payload = r.requestPayload as { actionType?: string } | null;
      return payload?.actionType === option.actionType;
    });
    return match ? { id: match.id } : null;
  }
  return requests[0] ? { id: requests[0].id } : null;
}

/**
 * Approve an approval request by ID (e.g. send_draft).
 */
export async function approve(
  ctx: LiveContext,
  approvalRequestId: string,
): Promise<void> {
  await executeApprovalRequest({
    approvalRequestId,
    decidedByUserId: ctx.user.id,
    reason: "E2E approval",
  });
}

/**
 * Send an email (to self or other). Returns messageId and threadId from Gmail API.
 * If fromOverride is set, returns a ParsedMessage-like object with that from for processHistoryItem.
 */
export async function sendInboundEmail(
  ctx: LiveContext,
  opts: {
    to: string;
    subject: string;
    body: string;
    fromOverride?: string;
  },
): Promise<{
  messageId: string;
  threadId: string;
  parsedForPipeline?: {
    messageId: string;
    threadId: string;
    from: string;
    subject: string;
    snippet: string;
  };
}> {
  const result = await sendEmailWithHtml(ctx.gmail, {
    to: opts.to,
    subject: opts.subject,
    messageHtml: `<p>${opts.body.replace(/\n/g, "</p><p>")}</p>`,
  });
  const messageId = result.data.id ?? "";
  const threadId = result.data.threadId ?? "";
  if (!messageId || !threadId) {
    throw new Error("sendEmailWithHtml did not return id/threadId");
  }
  const out: {
    messageId: string;
    threadId: string;
    parsedForPipeline?: {
      messageId: string;
      threadId: string;
      from: string;
      subject: string;
      snippet: string;
    };
  } = { messageId, threadId };
  if (opts.fromOverride) {
    out.parsedForPipeline = {
      messageId,
      threadId,
      from: opts.fromOverride,
      subject: opts.subject,
      snippet: opts.body,
    };
  }
  return out;
}

/**
 * List sent messages (Gmail API). Optional query e.g. "in:sent subject:Re: ..."
 */
export async function listSentMessages(
  ctx: LiveContext,
  query?: string,
): Promise<{ id: string; threadId: string }[]> {
  const res = await ctx.gmail.users.messages.list({
    userId: "me",
    q: query ?? "in:sent",
    maxResults: 20,
  });
  const messages = res.data.messages ?? [];
  return messages.map((m) => ({
    id: m.id ?? "",
    threadId: m.threadId ?? "",
  }));
}

/**
 * Get a single message by ID.
 */
export async function getMessage(
  ctx: LiveContext,
  messageId: string,
): Promise<{ threadId: string; subject?: string }> {
  const msg = await ctx.emailProvider.getMessage(messageId);
  return {
    threadId: msg.threadId,
    subject: msg.headers?.subject,
  };
}

/**
 * Create a calendar event. Optional description prefix for cleanup (e.g. E2E_TEST_EVENT).
 */
export async function createCalendarEvent(
  ctx: LiveContext,
  opts: {
    title: string;
    start: Date;
    end: Date;
    description?: string;
  },
): Promise<{ id: string }> {
  const event = await ctx.calendarProvider.createEvent(ctx.calendarId, {
    title: opts.title,
    start: opts.start,
    end: opts.end,
    timeZone: ctx.timeZone,
    description: opts.description,
  });
  return { id: event.id };
}

/**
 * Update an existing calendar event (e.g. change start/end).
 */
export async function updateCalendarEvent(
  ctx: LiveContext,
  eventId: string,
  opts: { title?: string; start?: Date; end?: Date },
): Promise<void> {
  await ctx.calendarProvider.updateEvent(ctx.calendarId, eventId, {
    title: opts.title,
    start: opts.start,
    end: opts.end,
    timeZone: ctx.timeZone,
  });
}

/**
 * Delete a calendar event (single instance or series).
 */
export async function deleteCalendarEvent(
  ctx: LiveContext,
  eventId: string,
  options?: { mode?: "single" | "series" },
): Promise<void> {
  await ctx.calendarProvider.deleteEvent(
    ctx.calendarId,
    eventId,
    options ?? { mode: "single" },
  );
}

/**
 * List calendar events in a time range (for verification).
 */
export async function listCalendarEvents(
  ctx: LiveContext,
  timeMin: Date,
  timeMax: Date,
  query?: string,
): Promise<Array<{ id: string; title?: string; start: Date; end: Date; attendees?: string[] }>> {
  const events = await ctx.calendarProvider.fetchEvents({
    timeMin,
    timeMax,
    maxResults: 50,
    calendarId: ctx.calendarId,
  });
  let list = events.map((e) => ({
    id: e.id,
    title: e.title ?? undefined,
    start: new Date(e.startTime),
    end: new Date(e.endTime),
    attendees: e.attendees?.map((a) => a.email).filter(Boolean) as string[],
  }));
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((e) => e.title?.toLowerCase().includes(q));
  }
  return list;
}

/**
 * Get a single calendar event by ID.
 */
export async function getCalendarEvent(
  ctx: LiveContext,
  eventId: string,
): Promise<{ id: string; title?: string; start: Date; end: Date } | null> {
  try {
    const event = await ctx.calendarProvider.getEvent(eventId, ctx.calendarId);
    if (!event) return null;
    return {
      id: event.id,
      title: event.title ?? undefined,
      start: new Date(event.startTime),
      end: new Date(event.endTime),
    };
  } catch {
    return null;
  }
}

/**
 * Sleep for ms (e.g. wait for sync or API propagation).
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
