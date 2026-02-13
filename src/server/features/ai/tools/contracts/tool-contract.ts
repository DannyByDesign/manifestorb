import type { ZodTypeAny } from "zod";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

export type ToolRiskLevel = "safe" | "caution" | "dangerous";

export interface ToolEffectDescriptor {
  resource: "email" | "calendar" | "planner" | "preferences" | "rule";
  mutates: boolean;
}

export interface ToolContractMetadata {
  readOnly: boolean;
  riskLevel: ToolRiskLevel;
  approvalOperation: string;
  intentFamilies: string[];
  tags: string[];
  effects: ToolEffectDescriptor[];
  groups?: string[];
  providerAllowList?: string[];
}

export interface ToolExecutionContext {
  userId: string;
  emailAccountId: string;
  provider: string;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
}

export interface ToolContract {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  execute: (args: Record<string, unknown>) => Promise<RuntimeToolResult>;
  metadata: ToolContractMetadata;
}
