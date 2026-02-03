import type { Prisma } from "@/generated/prisma/client";

// EmailAccountWithAI contains the email account data needed for AI operations
// Note: AI routing is now handled by the system, not user-configurable
export type EmailAccountWithAI = Prisma.EmailAccountGetPayload<{
  select: {
    id: true;
    userId: true;
    email: true;
    about: true;
    multiRuleSelectionEnabled: true;
    timezone: true;
    calendarBookingLink: true;
    account: {
      select: {
        provider: true;
      };
    };
  };
}>;
