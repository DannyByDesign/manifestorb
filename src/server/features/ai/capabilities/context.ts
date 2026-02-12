import { createEmailProvider } from "@/server/features/ai/tools/providers/email";
import { createCalendarProvider } from "@/server/features/ai/tools/providers/calendar";
import { createAutomationProvider } from "@/server/features/ai/tools/providers/automation";
import type { ToolContext } from "@/server/features/ai/tools/types";
import type { CapabilityRuntimeContext } from "@/server/features/ai/capabilities/types";

export async function createCapabilityToolContext(
  runtime: CapabilityRuntimeContext,
): Promise<ToolContext> {
  const createUnavailableAutomationProvider = (reason: string) => {
    const fail = async () => {
      throw new Error(reason);
    };
    return {
      listRules: async () => [],
      createRule: fail,
      updateRule: fail,
      deleteRule: fail,
      deleteTemporaryRulesByName: fail,
      listKnowledge: async () => [],
      createKnowledge: fail,
      deleteKnowledge: fail,
      generateReport: fail,
      unsubscribe: async () => ({ success: false, error: reason }),
      matchRules: async () => ({ matches: [], reasoning: reason }),
    } as const;
  };

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

  let automationProvider;
  try {
    automationProvider = await createAutomationProvider(runtime.userId, runtime.logger);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation provider unavailable";
    runtime.logger.warn("Automation provider failed to initialize; using degraded fallback", {
      error,
    });
    automationProvider = createUnavailableAutomationProvider(message);
  }

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
      automation: automationProvider,
    },
  };
}
