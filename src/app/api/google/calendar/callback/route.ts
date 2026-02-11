import { withError } from "@/server/lib/middleware";
import { handleCalendarCallback } from "@/features/calendar/handle-calendar-callback";
import { createGoogleCalendarProvider } from "@/features/calendar/providers/google";

export const GET = withError("google/calendar/callback", async (request) => {
  return handleCalendarCallback(
    request,
    createGoogleCalendarProvider(request.logger, request.nextUrl.origin),
    request.logger,
  );
});
