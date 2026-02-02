
import { type Logger } from "@/server/lib/logger";

// Placeholder for now
export interface CalendarProvider {
    searchEvents(query: string, range: { start: Date; end: Date }): Promise<any[]>;
}

export async function createCalendarProvider(
    account: any,
    logger: Logger
): Promise<CalendarProvider> {
    // Return a dummy for now until we have calendar integration code
    return {
        searchEvents: async () => []
    };
}
