import type { Logger } from "@/server/lib/logger";
import { createScopedLogger } from "@/server/lib/logger";
import {
  compileRuntimeTurn,
  inferDomainFromTaskClauses,
  inferOperationFromTaskClauses,
  inferRouteProfileFromComplexity,
  inferToolHints,
  type RuntimeCompiledTurn,
  type RuntimeSingleToolCall,
  type RuntimeToolChoice,
  type RuntimeKnowledgeSource,
  type RuntimeFreshness,
} from "@/server/features/ai/runtime/turn-compiler";

export type RuntimeTurnIntent =
  | "greeting"
  | "capabilities"
  | "inbox_read"
  | "inbox_attention"
  | "inbox_mutation"
  | "calendar_read"
  | "calendar_mutation"
  | "policy_controls"
  | "cross_surface_plan"
  | "general";

export type RuntimeTurnDomain =
  | "general"
  | "inbox"
  | "calendar"
  | "policy"
  | "cross_surface";

export type RuntimeRequestedOperation = "meta" | "read" | "mutate" | "mixed";
export type RuntimeComplexity = "simple" | "moderate" | "complex";
export type RuntimeRouteProfile = "fast" | "standard" | "deep";
export type RuntimeRiskLevel = "low" | "medium" | "high";

export interface RuntimeTurnContract {
  intent: RuntimeTurnIntent;
  domain: RuntimeTurnDomain;
  requestedOperation: RuntimeRequestedOperation;
  complexity: RuntimeComplexity;
  routeProfile: RuntimeRouteProfile;
  routeHint: "conversation_only" | "single_tool" | "planner";
  toolChoice: RuntimeToolChoice;
  knowledgeSource: RuntimeKnowledgeSource;
  freshness: RuntimeFreshness;
  riskLevel: RuntimeRiskLevel;
  confidence: number;
  toolHints: string[];
  source: "compiler_model" | "compiler_fallback";
  conversationClauses: string[];
  taskClauses: RuntimeCompiledTurn["taskClauses"];
  metaConstraints: string[];
  needsClarification: boolean;
  singleToolCall?: RuntimeSingleToolCall;
}

function inferIntent(params: {
  message: string;
  domain: RuntimeTurnDomain;
  requestedOperation: RuntimeRequestedOperation;
}): RuntimeTurnIntent {
  const normalized = params.message.toLowerCase();
  if (/^(hi|hello|hey|yo|sup|howdy)\b/u.test(normalized)) return "greeting";
  if (/\b(what can you do|capabilit(?:y|ies)|how can you help|what do you do)\b/u.test(normalized)) {
    return "capabilities";
  }

  if (params.domain === "cross_surface") return "cross_surface_plan";
  if (params.domain === "inbox") {
    if (/\bunread|attention|reply\b/u.test(normalized)) return "inbox_attention";
    if (params.requestedOperation === "mutate" || params.requestedOperation === "mixed") {
      return "inbox_mutation";
    }
    return "inbox_read";
  }
  if (params.domain === "calendar") {
    if (params.requestedOperation === "mutate" || params.requestedOperation === "mixed") {
      return "calendar_mutation";
    }
    return "calendar_read";
  }
  if (params.domain === "policy") return "policy_controls";
  return "general";
}

function inferComplexity(message: string, requestedOperation: RuntimeRequestedOperation): RuntimeComplexity {
  const normalized = message.toLowerCase();
  const tokens = normalized.split(/\s+/u).filter(Boolean).length;
  const hasConditional = /\b(if|unless|otherwise|except|only if|when)\b/u.test(normalized);
  const chainingCount = [
    ...normalized.matchAll(/\b(and then|then|also|plus|follow(?:ed)? by|after that|before that|next)\b/gu),
  ].length;

  if (tokens > 45 || hasConditional || chainingCount >= 2) return "complex";
  if (tokens > 20 || requestedOperation === "mutate" || chainingCount === 1) return "moderate";
  return "simple";
}

function inferRisk(message: string, requestedOperation: RuntimeRequestedOperation): RuntimeRiskLevel {
  if (requestedOperation === "meta" || requestedOperation === "read") return "low";
  if (/\b(delete|trash|block|unsubscribe|cancel all|remove all|archive all)\b/u.test(message.toLowerCase())) {
    return "high";
  }
  return "medium";
}

export async function classifyRuntimeTurnContract(params: {
  message: string;
  userId: string;
  email: string;
  emailAccountId: string;
  contextPack?: import("@/server/features/memory/context-manager").ContextPack;
  logger?: Logger;
}): Promise<RuntimeTurnContract> {
  const message = params.message.trim();
  const logger = params.logger ?? createScopedLogger("RuntimeTurnContract");

  if (!message) {
    return {
      intent: "general",
      domain: "general",
      requestedOperation: "meta",
      complexity: "simple",
      routeProfile: "fast",
      routeHint: "conversation_only",
      toolChoice: "none",
      knowledgeSource: "either",
      freshness: "low",
      riskLevel: "low",
      confidence: 0.6,
      toolHints: [],
      source: "compiler_fallback",
      conversationClauses: [],
      taskClauses: [],
      metaConstraints: [],
      needsClarification: false,
    };
  }

  const compiled = await compileRuntimeTurn({
    message,
    userId: params.userId,
    email: params.email,
    emailAccountId: params.emailAccountId,
    logger,
    contextPack: params.contextPack,
  });

  const domain = inferDomainFromTaskClauses(compiled.taskClauses) as RuntimeTurnDomain;
  const requestedOperation = inferOperationFromTaskClauses(compiled.taskClauses);
  const complexity = inferComplexity(message, requestedOperation);
  const routeProfile = inferRouteProfileFromComplexity(complexity);
  const riskLevel = inferRisk(message, requestedOperation);
  const intent = inferIntent({ message, domain, requestedOperation });

  const contract: RuntimeTurnContract = {
    intent,
    domain,
    requestedOperation,
    complexity,
    routeProfile,
    routeHint: compiled.routeHint,
    toolChoice: compiled.toolChoice,
    knowledgeSource: compiled.knowledgeSource,
    freshness: compiled.freshness,
    riskLevel,
    confidence: Number(compiled.confidence.toFixed(4)),
    toolHints: inferToolHints({ domain, requestedOperation }),
    source: compiled.source,
    conversationClauses: compiled.conversationClauses,
    taskClauses: compiled.taskClauses,
    metaConstraints: compiled.metaConstraints,
    needsClarification: compiled.needsClarification,
    ...(compiled.singleToolCall ? { singleToolCall: compiled.singleToolCall } : {}),
  };

  logger.trace("Runtime turn contract resolved", {
    intent: contract.intent,
    domain: contract.domain,
    requestedOperation: contract.requestedOperation,
    complexity: contract.complexity,
    routeProfile: contract.routeProfile,
    routeHint: contract.routeHint,
    confidence: contract.confidence,
    source: contract.source,
    metaConstraints: contract.metaConstraints,
    hasSingleToolCall: Boolean(contract.singleToolCall),
  });

  return contract;
}
