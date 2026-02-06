import { describe, expect, it, vi } from "vitest";
import { getGmailClientWithRefresh } from "@/server/integrations/google/client";
import { GmailProvider } from "@/server/features/email/providers/google";
import { createScopedLogger } from "@/server/lib/logger";
import { GoogleCalendarEventProvider } from "@/features/calendar/providers/google-events";
import { sendEmailWithHtml } from "@/server/integrations/google/mail";

vi.mock("server-only", () => ({}));

const describeLive = describe.runIf(process.env.RUN_LIVE_E2E === "true");

describeLive("live Google flow", () => {
  it("reads email, creates event, and sends confirmation", async () => {
    const required = [
      "LIVE_GOOGLE_ACCESS_TOKEN",
      "LIVE_GOOGLE_REFRESH_TOKEN",
      "LIVE_GOOGLE_EMAIL",
      "LIVE_GMAIL_QUERY",
      "LIVE_GMAIL_RECIPIENT",
      "LIVE_MEETING_START",
      "LIVE_MEETING_END",
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing live E2E env vars: ${missing.join(", ")}`);
    }

    process.env.NEXT_PUBLIC_EMAIL_SEND_ENABLED = "true";

    const logger = createScopedLogger("live-google-flow");
    const accessToken = process.env.LIVE_GOOGLE_ACCESS_TOKEN || "";
    const refreshToken = process.env.LIVE_GOOGLE_REFRESH_TOKEN || "";
    const userEmail = process.env.LIVE_GOOGLE_EMAIL || "";
    const calendarId = process.env.LIVE_GOOGLE_CALENDAR_ID || "primary";
    const timeZone = process.env.LIVE_GOOGLE_TIME_ZONE || "UTC";
    const query = process.env.LIVE_GMAIL_QUERY || "";
    const recipient = process.env.LIVE_GMAIL_RECIPIENT || "";

    const gmail = await getGmailClientWithRefresh({
      accessToken,
      refreshToken,
      expiresAt: null,
      emailAccountId: "live-e2e",
      logger,
    });

    const gmailProvider = new GmailProvider(gmail, "live-e2e", logger);

    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 1,
    });
    const messageId = listResponse.data.messages?.[0]?.id;
    expect(messageId).toBeTruthy();

    const message = await gmailProvider.getMessage(messageId || "");
    expect(message.threadId).toBeTruthy();
    expect(message.headers.to?.includes(userEmail)).toBe(true);

    const thread = await gmailProvider.getThread(message.threadId);
    expect(thread.messages.length).toBeGreaterThan(0);

    const calendarProvider = new GoogleCalendarEventProvider(
      {
        accessToken,
        refreshToken,
        expiresAt: null,
        emailAccountId: "live-e2e",
        userId: "live-e2e",
        timeZone,
      },
      logger,
    );

    const start = new Date(process.env.LIVE_MEETING_START || "");
    const end = new Date(process.env.LIVE_MEETING_END || "");
    const title = "Proposal discussion (live e2e)";

    let createdEventId: string | null = null;
    try {
      const event = await calendarProvider.createEvent(calendarId, {
        title,
        start,
        end,
        timeZone,
      });
      createdEventId = event.id;
      expect(event.id).toBeTruthy();

      await sendEmailWithHtml(gmail, {
        to: recipient,
        subject: `Confirmed: ${title}`,
        messageHtml: "<p>Confirmed. Calendar invite has been sent.</p>",
        replyToEmail: {
          threadId: thread.id,
          headerMessageId: message.headers["message-id"] || "",
          references: message.headers.references,
        },
      });
    } finally {
      if (createdEventId) {
        await calendarProvider.deleteEvent(calendarId, createdEventId, {
          mode: "single",
        });
      }
    }
  });
});
