import { createCapabilities } from "@/server/features/ai/tools/runtime/capabilities";
import { loadRuntimeSkills } from "@/server/features/ai/skills/loader";
import { buildSkillPromptSnapshot } from "@/server/features/ai/skills/snapshot";
import { assembleRuntimeTools } from "@/server/features/ai/tools/fabric/assembler";
import { filterToolRegistryDetailed } from "@/server/features/ai/tools/fabric/policy-filter";
import {
  buildRuntimeToolRegistryContext,
  buildToolNameLookup,
} from "@/server/features/ai/tools/fabric/registry";
import { classifyRuntimeSemanticContract } from "@/server/features/ai/runtime/semantic-contract";
import { resolveEffectiveToolPolicy } from "@/server/features/ai/tools/policy/policy-resolver";
import { expandPolicyWithPluginGroups } from "@/server/features/ai/tools/policy/tool-policy";
import { getModel } from "@/server/lib/llms/model";
import prisma from "@/server/db/client";
import type { RuntimeSession, OpenWorldTurnInput } from "@/server/features/ai/runtime/types";
import type { ToolExecutionSummary } from "@/server/features/ai/tools/fabric/types";

export async function createRuntimeSession(input: OpenWorldTurnInput): Promise<RuntimeSession> {
  const [capabilities, userAiConfig, semantic] = await Promise.all([
    createCapabilities({
      userId: input.userId,
      emailAccountId: input.emailAccountId,
      email: input.email,
      provider: input.providerName,
      logger: input.logger,
      conversationId: input.conversationId,
      currentMessage: input.message,
      sourceEmailMessageId: input.sourceEmailMessageId,
      sourceEmailThreadId: input.sourceEmailThreadId,
    }),
    prisma.userAIConfig.findUnique({
      where: { userId: input.userId },
      select: {
        maxSteps: true,
        approvalInstructions: true,
        customInstructions: true,
        conversationCategories: true,
        toolProfile: true,
        toolAllow: true,
        toolAlsoAllow: true,
        toolDeny: true,
        toolByProvider: true,
        toolByAgent: true,
        toolByGroup: true,
        toolSandboxPolicy: true,
        toolSubagentPolicy: true,
      },
    }),
    classifyRuntimeSemanticContract({
      message: input.message,
      logger: input.logger,
    }),
  ]);

  const loadedSkills = loadRuntimeSkills();
  const skillSnapshot = buildSkillPromptSnapshot({
    message: input.message,
    skills: loadedSkills,
  });

  const registryContext = buildRuntimeToolRegistryContext();
  const fullRegistry = registryContext.registry;

  const routingModel = getModel("economy");
  const resolvedLayers = resolveEffectiveToolPolicy({
    config: userAiConfig
      ? {
          toolProfile: userAiConfig.toolProfile,
          toolAllow: userAiConfig.toolAllow,
          toolAlsoAllow: userAiConfig.toolAlsoAllow,
          toolDeny: userAiConfig.toolDeny,
          toolByProvider: userAiConfig.toolByProvider,
          toolByAgent: userAiConfig.toolByAgent,
          toolByGroup: userAiConfig.toolByGroup,
          toolSandboxPolicy: userAiConfig.toolSandboxPolicy,
          toolSubagentPolicy: userAiConfig.toolSubagentPolicy,
        }
      : undefined,
    agentId: input.agentId,
    modelProvider: routingModel.provider,
    modelId: routingModel.modelName,
    groupId: input.groupId,
    groupChannel: input.groupChannel ?? input.provider,
    channelId: input.channelId,
  });

  const layeredPolicies = {
    ...resolvedLayers,
    profilePolicy: expandPolicyWithPluginGroups(
      resolvedLayers.profilePolicy,
      registryContext.pluginGroups,
    ),
    providerProfilePolicy: expandPolicyWithPluginGroups(
      resolvedLayers.providerProfilePolicy,
      registryContext.pluginGroups,
    ),
    globalPolicy: expandPolicyWithPluginGroups(
      resolvedLayers.globalPolicy,
      registryContext.pluginGroups,
    ),
    globalProviderPolicy: expandPolicyWithPluginGroups(
      resolvedLayers.globalProviderPolicy,
      registryContext.pluginGroups,
    ),
    agentPolicy: expandPolicyWithPluginGroups(
      resolvedLayers.agentPolicy,
      registryContext.pluginGroups,
    ),
    agentProviderPolicy: expandPolicyWithPluginGroups(
      resolvedLayers.agentProviderPolicy,
      registryContext.pluginGroups,
    ),
    groupPolicy: expandPolicyWithPluginGroups(
      resolvedLayers.groupPolicy,
      registryContext.pluginGroups,
    ),
    sandboxPolicy: expandPolicyWithPluginGroups(
      resolvedLayers.sandboxPolicy,
      registryContext.pluginGroups,
    ),
    subagentPolicy: expandPolicyWithPluginGroups(
      resolvedLayers.subagentPolicy,
      registryContext.pluginGroups,
    ),
  };

  const filtered = filterToolRegistryDetailed(fullRegistry, {
    includeDangerous: semantic.riskLevel === "high" && semantic.requestedOperation !== "read",
    message: input.message,
    semantic,
    layeredPolicies,
    additionalGroups: registryContext.additionalGroups,
  });
  const registry = filtered.tools;
  const toolLookup = buildToolNameLookup(registry);

  input.logger.info("Runtime semantic gate applied", {
    semanticIntent: semantic.intent,
    semanticDomain: semantic.domain,
    semanticOperation: semantic.requestedOperation,
    semanticComplexity: semantic.complexity,
    semanticRouteProfile: semantic.routeProfile,
    semanticRiskLevel: semantic.riskLevel,
    semanticConfidence: semantic.confidence,
    toolCountBefore: fullRegistry.length,
    toolCountSemanticCandidate: filtered.diagnostics.counts.semanticCandidate,
    toolCountAfterProfile: filtered.diagnostics.counts.afterProfile,
    toolCountAfterProviderProfile: filtered.diagnostics.counts.afterProviderProfile,
    toolCountAfterGlobal: filtered.diagnostics.counts.afterGlobal,
    toolCountAfterGlobalProvider: filtered.diagnostics.counts.afterGlobalProvider,
    toolCountAfterAgent: filtered.diagnostics.counts.afterAgent,
    toolCountAfterAgentProvider: filtered.diagnostics.counts.afterAgentProvider,
    toolCountAfterGroup: filtered.diagnostics.counts.afterGroup,
    toolCountAfterSandbox: filtered.diagnostics.counts.afterSandbox,
    toolCountAfterSubagent: filtered.diagnostics.counts.afterSubagent,
    toolCountAfterRisk: filtered.diagnostics.counts.afterRisk,
    toolCountAfter: registry.length,
  });

  const artifacts = {
    approvals: [] as Array<{ id: string; requestPayload?: unknown }>,
    interactivePayloads: [] as unknown[],
  };

  const summaries: ToolExecutionSummary[] = [];

  const tools = assembleRuntimeTools({
    registry,
    context: {
      policy: {
        userId: input.userId,
        emailAccountId: input.emailAccountId,
        provider: input.provider,
        conversationId: input.conversationId,
        channelId: input.channelId,
        threadId: input.threadId,
        messageId: input.messageId,
        source: "runtime",
      },
      capabilities,
    },
    artifacts,
    summaries,
  });

  return {
    input,
    capabilities,
    semantic,
    skillSnapshot,
    userPromptConfig: userAiConfig
      ? {
          maxSteps: userAiConfig.maxSteps ?? undefined,
          approvalInstructions: userAiConfig.approvalInstructions ?? undefined,
          customInstructions: userAiConfig.customInstructions ?? undefined,
          conversationCategories: userAiConfig.conversationCategories ?? undefined,
        }
      : undefined,
    tools,
    toolRegistry: registry,
    toolLookup,
    artifacts,
    summaries,
  };
}
