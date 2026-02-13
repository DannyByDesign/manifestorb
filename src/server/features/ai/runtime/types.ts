import type { ModelMessage, ToolSet } from "ai";
import type { Logger } from "@/server/lib/logger";
import type { SkillCapabilities } from "@/server/features/ai/tools/runtime/legacy";
import type { RuntimeSkillSnapshot } from "@/server/features/ai/skills/types";
import type {
  ToolExecutionArtifacts,
  ToolExecutionSummary,
  RuntimeToolDefinition,
} from "@/server/features/ai/tools/fabric/types";

export interface OpenWorldTurnInput {
  provider: string;
  providerName: string;
  userId: string;
  emailAccountId: string;
  email: string;
  message: string;
  messages?: ModelMessage[];
  logger: Logger;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
}

export interface RuntimeSession {
  input: OpenWorldTurnInput;
  capabilities: SkillCapabilities;
  skillSnapshot: RuntimeSkillSnapshot;
  tools: ToolSet;
  toolRegistry: RuntimeToolDefinition[];
  toolLookup: Map<string, RuntimeToolDefinition>;
  artifacts: ToolExecutionArtifacts;
  summaries: ToolExecutionSummary[];
}

export interface OpenWorldTurnResult {
  text: string;
  approvals: Array<{ id: string; requestPayload?: unknown }>;
  interactivePayloads: unknown[];
  selectedSkillIds: string[];
  toolSummaries: ToolExecutionSummary[];
}
