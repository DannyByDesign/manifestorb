import type { Prisma } from "@/generated/prisma/client";

// EmailAccountWithAI contains the email account data needed for AI operations
// Note: AI routing is now handled by the system, not user-configurable
export type EmailAccountWithAI = Prisma.EmailAccountGetPayload<{
  select: {
    id: true;
    userId: true;
    email: true;
    about: true;
    filingEnabled: true;
    filingPrompt: true;
    multiRuleSelectionEnabled: true;
    timezone: true;
    calendarBookingLink: true;
    account: {
      select: {
        provider: true;
      };
    };
  };
}> & {
  // This field exists in Prisma, but many call-sites intentionally don't select it.
  // Treat it as optional so helpers can use it when present without forcing wider selects.
  aiRuleTimeoutMs?: number | null;
};
