import { withError } from "@/server/lib/middleware";
import { handleCalendarCallback } from "@/features/calendar/handle-calendar-callback";
import { createGoogleCalendarProvider } from "@/features/calendar/providers/google";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";

export const GET = withError("google/calendar/callback", async (request) => {
  return handleCalendarCallback(
    request,
    createGoogleCalendarProvider(
      request.logger,
      resolveOAuthBaseUrl(request.nextUrl.origin),
    ),
    request.logger,
  );
});
