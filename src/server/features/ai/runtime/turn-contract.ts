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
  domain: RuntimeTurnDomain;
  requestedOperation: RuntimeRequestedOperation;
  routeHint: RuntimeCompiledTurn["routeHint"];
  toolChoice: RuntimeCompiledTurn["toolChoice"];
}): RuntimeTurnIntent {
  if (params.routeHint === "conversation_only" && params.toolChoice === "none") {
    return "general";
  }

  if (params.domain === "cross_surface") return "cross_surface_plan";
  if (params.domain === "inbox") {
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

function inferComplexity(params: {
  taskClauses: RuntimeCompiledTurn["taskClauses"];
  domain: RuntimeTurnDomain;
  requestedOperation: RuntimeRequestedOperation;
  routeHint: RuntimeCompiledTurn["routeHint"];
  needsClarification: boolean;
}): RuntimeComplexity {
  if (params.routeHint === "conversation_only") return "simple";
  if (
    params.domain === "cross_surface" ||
    params.requestedOperation === "mixed" ||
    params.taskClauses.length >= 3
  ) {
    return "complex";
  }
  if (
    params.requestedOperation === "mutate" ||
    params.taskClauses.length >= 1 ||
    params.needsClarification
  ) {
    return "moderate";
  }
  return "simple";
}

function inferRisk(params: {
  domain: RuntimeTurnDomain;
  requestedOperation: RuntimeRequestedOperation;
}): RuntimeRiskLevel {
  if (params.requestedOperation === "meta" || params.requestedOperation === "read") return "low";
  if (params.domain === "cross_surface" && params.requestedOperation === "mixed") {
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
  const complexity = inferComplexity({
    taskClauses: compiled.taskClauses,
    domain,
    requestedOperation,
    routeHint: compiled.routeHint,
    needsClarification: compiled.needsClarification,
  });
  const routeProfile = inferRouteProfileFromComplexity(complexity);
  const riskLevel = inferRisk({ domain, requestedOperation });
  const intent = inferIntent({
    domain,
    requestedOperation,
    routeHint: compiled.routeHint,
    toolChoice: compiled.toolChoice,
  });

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
