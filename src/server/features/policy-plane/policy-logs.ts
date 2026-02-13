import prisma from "@/server/db/client";

type DecisionKind = "allow" | "block" | "require_approval" | "allow_with_transform";

export async function createPolicyDecisionLog(params: {
  userId: string;
  emailAccountId?: string;
  canonicalRuleId?: string;
  source: string;
  toolName: string;
  mutationResource?: string;
  mutationOperation?: string;
  args: Record<string, unknown>;
  decisionKind: DecisionKind;
  reasonCode: string;
  message: string;
  requiresApproval?: boolean;
  approvalPayload?: Record<string, unknown>;
  transformedArgs?: Record<string, unknown>;
  correlationId?: string;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
}) {
  return prisma.policyDecisionLog.create({
    data: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      canonicalRuleId: params.canonicalRuleId,
      source: params.source,
      toolName: params.toolName,
      mutationResource: params.mutationResource,
      mutationOperation: params.mutationOperation,
      args: params.args as unknown as object,
      decisionKind: params.decisionKind,
      reasonCode: params.reasonCode,
      message: params.message,
      requiresApproval: params.requiresApproval ?? false,
      approvalPayload: params.approvalPayload as unknown as object | undefined,
      transformedArgs: params.transformedArgs as unknown as object | undefined,
      correlationId: params.correlationId,
      conversationId: params.conversationId,
      channelId: params.channelId,
      threadId: params.threadId,
      messageId: params.messageId,
    },
  });
}

export async function createPolicyExecutionLog(params: {
  userId: string;
  emailAccountId?: string;
  policyDecisionLogId?: string;
  source: string;
  toolName: string;
  mutationResource?: string;
  mutationOperation?: string;
  args: Record<string, unknown>;
  outcome: "executed" | "deferred_approval" | "blocked" | "failed" | "skipped";
  result?: Record<string, unknown>;
  error?: string;
  correlationId?: string;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
}) {
  return prisma.policyExecutionLog.create({
    data: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      policyDecisionLogId: params.policyDecisionLogId,
      source: params.source,
      toolName: params.toolName,
      mutationResource: params.mutationResource,
      mutationOperation: params.mutationOperation,
      args: params.args as unknown as object,
      outcome: params.outcome,
      result: params.result as unknown as object | undefined,
      error: params.error,
      correlationId: params.correlationId,
      conversationId: params.conversationId,
      channelId: params.channelId,
      threadId: params.threadId,
      messageId: params.messageId,
    },
  });
}
