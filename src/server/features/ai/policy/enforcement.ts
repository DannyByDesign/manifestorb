import { createHash } from "crypto";
import prisma from "@/server/db/client";
import { evaluatePolicyDecision } from "@/server/features/policy-plane/pdp";
import { ApprovalService, getApprovalExpiry } from "@/server/features/approvals/service";
import type { CapabilityDefinition as RuntimeToolMetadata } from "@/server/features/ai/tools/runtime/capabilities/registry";

export interface PolicyExecutionContext {
  userId: string;
  emailAccountId: string;
  provider: string;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
  source: "skills" | "runtime" | "automation" | "scheduled";
}

export interface PolicyApprovalRecord {
  id: string;
  requestPayload?: unknown;
}

export type PolicyEnforcementResult =
  | {
      kind: "allow";
      args: Record<string, unknown>;
    }
  | {
      kind: "block";
      message: string;
      reasonCode: string;
    }
  | {
      kind: "require_approval";
      message: string;
      reasonCode: string;
      approval: PolicyApprovalRecord;
    };

function mapProvider(provider: string): "web" | "slack" | "discord" | "telegram" | "system" {
  if (provider === "web" || provider === "slack" || provider === "discord" || provider === "telegram") {
    return provider;
  }
  return "system";
}

function inferResource(definition: RuntimeToolMetadata): string {
  const mutatingEffect = definition.effects.find((effect) => effect.mutates);
  if (mutatingEffect) return mutatingEffect.resource;
  const first = definition.effects[0];
  return first ? first.resource : "workflow";
}

function approvalPayloadForTool(params: {
  toolName: string;
  args: Record<string, unknown>;
  context: PolicyExecutionContext;
  definition: RuntimeToolMetadata;
}) {
  const { toolName, args, context, definition } = params;
  return {
    actionType: "tool_execute",
    description: `Tool ${toolName} requires approval`,
    tool: toolName,
    toolName,
    args,
    emailAccountId: context.emailAccountId,
    conversationId: context.conversationId,
    channelId: context.channelId,
    threadId: context.threadId,
    messageId: context.messageId,
    operation: definition.approvalOperation,
    resource: inferResource(definition),
  };
}

async function createApprovalRequest(params: {
  context: PolicyExecutionContext;
  toolName: string;
  args: Record<string, unknown>;
  definition: RuntimeToolMetadata;
}): Promise<PolicyApprovalRecord> {
  const { context, toolName, args, definition } = params;
  const approvalService = new ApprovalService(prisma);
  const expiresInSeconds = await getApprovalExpiry(context.userId);
  const idempotencyKey = createHash("sha256")
    .update(
      JSON.stringify({
        kind: "tool_approval",
        userId: context.userId,
        emailAccountId: context.emailAccountId,
        toolName,
        args,
        conversationId: context.conversationId,
        threadId: context.threadId,
      }),
    )
    .digest("hex");

  const requestPayload = approvalPayloadForTool({
    toolName,
    args,
    context,
    definition,
  });

  const approvalRequest = await approvalService.createRequest({
    userId: context.userId,
    provider: mapProvider(context.provider),
    externalContext: {
      source: context.source,
      conversationId: context.conversationId,
      channelId: context.channelId,
      threadId: context.threadId,
      messageId: context.messageId,
    },
    requestPayload,
    idempotencyKey,
    expiresInSeconds,
  });

  return {
    id: approvalRequest.id,
    requestPayload,
  };
}

export async function enforcePolicyForTool(params: {
  context: PolicyExecutionContext;
  toolName: string;
  args: Record<string, unknown>;
  definition: RuntimeToolMetadata;
}): Promise<PolicyEnforcementResult> {
  const { context, toolName, args, definition } = params;

  if (definition.readOnly) {
    return { kind: "allow", args };
  }

  const decision = await evaluatePolicyDecision({
    userId: context.userId,
    emailAccountId: context.emailAccountId,
    toolName,
    args,
    context: {
      source: context.source,
      provider: mapProvider(context.provider),
      conversationId: context.conversationId,
      channelId: context.channelId,
      threadId: context.threadId,
      messageId: context.messageId,
    },
  });

  if (decision.kind === "allow") {
    return { kind: "allow", args };
  }

  if (decision.kind === "allow_with_transform") {
    return {
      kind: "allow",
      args: decision.transformedArgs ?? args,
    };
  }

  if (decision.kind === "block") {
    return {
      kind: "block",
      message: decision.message,
      reasonCode: decision.reasonCode,
    };
  }

  const approval = await createApprovalRequest({
    context,
    toolName,
    args,
    definition,
  });

  return {
    kind: "require_approval",
    message: decision.message,
    reasonCode: decision.reasonCode,
    approval,
  };
}
