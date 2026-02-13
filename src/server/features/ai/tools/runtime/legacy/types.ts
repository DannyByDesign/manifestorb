import type { Logger } from "@/server/lib/logger";
import type { ToolContext } from "@/server/features/ai/tools/types";

export interface CapabilityRuntimeContext {
  userId: string;
  emailAccountId: string;
  email: string;
  provider: string;
  logger: Logger;
  conversationId?: string;
  currentMessage?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
}

export interface CapabilityEnvironment {
  toolContext: ToolContext;
  runtime: CapabilityRuntimeContext;
}
