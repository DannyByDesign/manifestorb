import { createEmailProvider } from "@/server/features/ai/tools/providers/email";
import { createCalendarProvider } from "@/server/features/ai/tools/providers/calendar";
import type { ToolContext } from "@/server/features/ai/tools/types";
import type { CapabilityRuntimeContext } from "@/server/features/ai/tools/runtime/legacy/types";

export async function createCapabilityToolContext(
  runtime: CapabilityRuntimeContext,
): Promise<ToolContext> {
  const emailProvider = await createEmailProvider(
    {
      id: runtime.emailAccountId,
      provider: runtime.provider,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      email: runtime.email,
    },
    runtime.logger,
  );

  const calendarProvider = await createCalendarProvider(
    { id: runtime.emailAccountId },
    runtime.userId,
    runtime.logger,
  );

  return {
    userId: runtime.userId,
    emailAccountId: runtime.emailAccountId,
    emailMessageId: runtime.sourceEmailMessageId,
    emailThreadId: runtime.sourceEmailThreadId,
    conversationId: runtime.conversationId,
    currentMessage: runtime.currentMessage,
    logger: runtime.logger,
    providers: {
      email: emailProvider,
      calendar: calendarProvider,
    },
  };
}
