import type { ModelMessage } from "ai";
import type { Logger } from "@/server/lib/logger";
import type { SkillCapabilities } from "@/server/features/ai/tools/runtime/capabilities";
import type { RuntimeSkillSnapshot } from "@/server/features/ai/skills/types";
import type { UserPromptConfig } from "@/server/features/ai/system-prompt";
import type { RuntimeTurnContract } from "@/server/features/ai/runtime/turn-contract";
import type { RuntimeToolHarness } from "@/server/features/ai/tools/harness/types";
import type {
  ToolExecutionArtifacts,
  ToolExecutionSummary,
  RuntimeToolDefinition,
} from "@/server/features/ai/tools/fabric/types";
import type { ContextPack } from "@/server/features/memory/context-manager";

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
  agentId?: string;
  channelId?: string;
  groupId?: string;
  groupChannel?: string;
  groupSpace?: string;
  threadId?: string;
  messageId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
  runtimeContextPack?: ContextPack;
  runtimeContextStatus?: "ready" | "degraded" | "missing";
  runtimeContextIssues?: string[];
  runtimeTurnContract?: RuntimeTurnContract;
}

export interface RuntimeSession {
  input: OpenWorldTurnInput;
  capabilities: SkillCapabilities;
  turn: RuntimeTurnContract;
  skillSnapshot: RuntimeSkillSnapshot;
  userPromptConfig?: UserPromptConfig;
  toolHarness: RuntimeToolHarness;
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
