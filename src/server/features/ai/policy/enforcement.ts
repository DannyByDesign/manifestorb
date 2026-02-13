import { createHash } from "crypto";
import prisma from "@/server/db/client";
import { evaluatePolicyDecision } from "@/server/features/policy-plane/pdp";
import { ApprovalService, getApprovalExpiry } from "@/server/features/approvals/service";
import type { CapabilityDefinition } from "@/server/features/ai/capabilities/registry";

export interface PolicyExecutionContext {
  userId: string;
  emailAccountId: string;
  provider: string;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
  source: "skills" | "planner" | "automation" | "scheduled";
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

function inferResource(definition: CapabilityDefinition): string {
  const mutatingEffect = definition.effects.find((effect) => effect.mutates);
  if (mutatingEffect) return mutatingEffect.resource;
  const first = definition.effects[0];
  return first ? first.resource : "workflow";
}

function approvalPayloadForCapability(params: {
  capabilityId: string;
  args: Record<string, unknown>;
  context: PolicyExecutionContext;
  definition: CapabilityDefinition;
}) {
  const { capabilityId, args, context, definition } = params;
  return {
    actionType: "capability_execute",
    description: `Capability ${capabilityId} requires approval`,
    tool: capabilityId,
    args,
    capabilityId,
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
  capabilityId: string;
  args: Record<string, unknown>;
  definition: CapabilityDefinition;
}): Promise<PolicyApprovalRecord> {
  const { context, capabilityId, args, definition } = params;
  const approvalService = new ApprovalService(prisma);
  const expiresInSeconds = await getApprovalExpiry(context.userId);
  const idempotencyKey = createHash("sha256")
    .update(
      JSON.stringify({
        kind: "capability_approval",
        userId: context.userId,
        emailAccountId: context.emailAccountId,
        capabilityId,
        args,
        conversationId: context.conversationId,
        threadId: context.threadId,
      }),
    )
    .digest("hex");

  const requestPayload = approvalPayloadForCapability({
    capabilityId,
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

export async function enforcePolicyForCapability(params: {
  context: PolicyExecutionContext;
  capabilityId: string;
  args: Record<string, unknown>;
  definition: CapabilityDefinition;
}): Promise<PolicyEnforcementResult> {
  const { context, capabilityId, args, definition } = params;

  if (definition.readOnly) {
    return { kind: "allow", args };
  }

  const decision = await evaluatePolicyDecision({
    userId: context.userId,
    emailAccountId: context.emailAccountId,
    toolName: capabilityId,
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
    capabilityId,
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
