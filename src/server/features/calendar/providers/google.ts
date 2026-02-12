import { env } from "@/env";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import {
  getCalendarOAuth2ClientForBaseUrl,
  fetchGoogleCalendars,
  getCalendarClientWithRefresh,
} from "@/features/calendar/client";
import type { CalendarOAuthProvider, CalendarTokens } from "../oauth-types";
import { autoPopulateTimezone } from "../timezone-helpers";
import {
  ensureGoogleCalendarWatch,
  syncGoogleCalendarChanges,
} from "@/features/calendar/sync/google";

export function createGoogleCalendarProvider(
  logger: Logger,
  baseUrl: string,
): CalendarOAuthProvider {
  return {
    name: "google",

    async exchangeCodeForTokens(code: string): Promise<CalendarTokens> {
      const googleAuth = getCalendarOAuth2ClientForBaseUrl(baseUrl);

      const { tokens } = await googleAuth.getToken(code);
      const { id_token, access_token, refresh_token, expiry_date } = tokens;

      if (!id_token) {
        throw new Error("Missing id_token from Google response");
      }

      if (!access_token) {
        throw new Error("Missing access_token from Google response");
      }

      // Google can omit refresh_token on subsequent consents. We'll preserve an
      // existing refresh token if we are reconnecting.
      if (!refresh_token) {
        logger.warn("Google did not return refresh_token for calendar OAuth; will attempt to preserve existing token", {
          hasAccessToken: !!access_token,
          scope: tokens.scope,
        });
      }

      const ticket = await googleAuth.verifyIdToken({
        idToken: id_token,
        audience: env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();

      if (!payload?.email) {
        throw new Error("Could not get email from ID token");
      }

      return {
        accessToken: access_token,
        refreshToken: refresh_token ?? null,
        expiresAt: expiry_date ? new Date(expiry_date) : null,
        email: payload.email,
      };
    },

    async syncCalendars(
      connectionId: string,
      accessToken: string,
      refreshToken: string,
      emailAccountId: string,
      expiresAt: Date | null,
    ): Promise<void> {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: { userId: true },
      });
      const userId = emailAccount?.userId;

      try {
        const calendarClient = await getCalendarClientWithRefresh({
          accessToken,
          refreshToken,
          expiresAt: expiresAt?.getTime() ?? null,
          emailAccountId,
          logger,
        });

        const googleCalendars = await fetchGoogleCalendars(
          calendarClient,
          logger,
        );

        for (const googleCalendar of googleCalendars) {
          if (!googleCalendar.id) continue;

          const calendar = await prisma.calendar.upsert({
            where: {
              connectionId_calendarId: {
                connectionId,
                calendarId: googleCalendar.id,
              },
            },
            update: {
              name: googleCalendar.summary || "Untitled Calendar",
              description: googleCalendar.description,
              timezone: googleCalendar.timeZone,
            },
            create: {
              connectionId,
              calendarId: googleCalendar.id,
              name: googleCalendar.summary || "Untitled Calendar",
              description: googleCalendar.description,
              timezone: googleCalendar.timeZone,
              isEnabled: true,
            },
          });

          await ensureGoogleCalendarWatch({
            calendar: {
              id: calendar.id,
              calendarId: calendar.calendarId,
              googleSyncToken: calendar.googleSyncToken,
              googleChannelId: calendar.googleChannelId,
              googleResourceId: calendar.googleResourceId,
              googleChannelToken: calendar.googleChannelToken,
              googleChannelExpiresAt: calendar.googleChannelExpiresAt,
            },
            connection: {
              accessToken,
              refreshToken,
              expiresAt,
              emailAccountId,
            },
            logger,
          });

          if (!calendar.googleSyncToken) {
            await syncGoogleCalendarChanges({
              calendar: {
                id: calendar.id,
                calendarId: calendar.calendarId,
                googleSyncToken: calendar.googleSyncToken,
                googleChannelId: calendar.googleChannelId,
                googleResourceId: calendar.googleResourceId,
                googleChannelToken: calendar.googleChannelToken,
                googleChannelExpiresAt: calendar.googleChannelExpiresAt,
              },
              connection: {
                accessToken,
                refreshToken,
                expiresAt,
                emailAccountId,
              },
              logger,
              userId,
            });
          }
        }

        await autoPopulateTimezone(emailAccountId, googleCalendars, logger);
      } catch (error) {
        logger.error("Error syncing calendars", { error, connectionId });
        await prisma.calendarConnection.update({
          where: { id: connectionId },
          data: { isConnected: false },
        });
        throw error;
      }
    },
  };
}
