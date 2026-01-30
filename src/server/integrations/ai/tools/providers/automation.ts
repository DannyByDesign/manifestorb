
import { type Logger } from "@/server/utils/logger";

// Placeholder for now
export interface AutomationProvider {
    listRules(): Promise<any[]>;
}

export async function createAutomationProvider(
    userId: string,
    logger: Logger
): Promise<AutomationProvider> {
    // Return a dummy for now
    return {
        listRules: async () => []
    };
}
