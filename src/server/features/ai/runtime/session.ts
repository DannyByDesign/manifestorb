import { createCapabilities } from "@/server/features/ai/tools/runtime/capabilities";
import { loadRuntimeSkills } from "@/server/features/ai/skills/loader";
import { buildSkillPromptSnapshot } from "@/server/features/ai/skills/snapshot";
import { filterToolRegistryDetailed } from "@/server/features/ai/tools/fabric/policy-filter";
import {
  buildRuntimeToolRegistryContext,
  buildToolNameLookup,
} from "@/server/features/ai/tools/fabric/registry";
import { toToolDefinitions } from "@/server/features/ai/tools/harness/tool-definition-adapter";
import { splitSdkTools } from "@/server/features/ai/tools/harness/tool-split";
import { classifyRuntimeSemanticContract } from "@/server/features/ai/runtime/semantic-contract";
import { resolveEffectiveToolPolicy } from "@/server/features/ai/tools/policy/policy-resolver";
import {
  expandPolicyWithPluginGroups,
  normalizeToolName,
  stripPluginOnlyAllowlist,
} from "@/server/features/ai/tools/policy/tool-policy";
import { getModel } from "@/server/lib/llms/model";
import prisma from "@/server/db/client";
import type { RuntimeSession, OpenWorldTurnInput } from "@/server/features/ai/runtime/types";
import type { ToolExecutionSummary } from "@/server/features/ai/tools/fabric/types";

export async function createRuntimeSession(input: OpenWorldTurnInput): Promise<RuntimeSession> {
  const isSubagentSession = Boolean(
    input.agentId && input.agentId.toLowerCase().includes("subagent"),
  );

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
          isSubagentSession,
        }
      : undefined,
    agentId: input.agentId,
    modelProvider: routingModel.provider,
    modelId: routingModel.modelName,
    groupId: input.groupId,
    groupChannel: input.groupChannel ?? input.provider,
    channelId: input.channelId,
  });

  const coreToolNames = new Set(
    fullRegistry.map((definition) => normalizeToolName(definition.toolName)).filter(Boolean),
  );
  const resolvePolicyLayer = (
    policy: typeof resolvedLayers.profilePolicy,
    label: string,
  ) => {
    const resolved = stripPluginOnlyAllowlist(
      policy,
      registryContext.pluginGroups,
      coreToolNames,
    );
    if (resolved.unknownAllowlist.length > 0) {
      const entries = resolved.unknownAllowlist.join(", ");
      const suffix = resolved.strippedAllowlist
        ? "Ignoring allowlist so core tools remain available. Use tools.alsoAllow for additive plugin tool enablement."
        : "These entries won't match any tool unless the plugin is enabled.";
      input.logger.warn(`tools: ${label} allowlist contains unknown entries (${entries}). ${suffix}`);
    }
    return expandPolicyWithPluginGroups(resolved.policy, registryContext.pluginGroups);
  };

  const layeredPolicies = {
    ...resolvedLayers,
    profilePolicy: resolvePolicyLayer(
      resolvedLayers.profilePolicy,
      resolvedLayers.profile ? `tools.profile (${resolvedLayers.profile})` : "tools.profile",
    ),
    providerProfilePolicy: resolvePolicyLayer(
      resolvedLayers.providerProfilePolicy,
      resolvedLayers.providerProfile
        ? `tools.byProvider.profile (${resolvedLayers.providerProfile})`
        : "tools.byProvider.profile",
    ),
    globalPolicy: resolvePolicyLayer(
      resolvedLayers.globalPolicy,
      "tools.allow",
    ),
    globalProviderPolicy: resolvePolicyLayer(
      resolvedLayers.globalProviderPolicy,
      "tools.byProvider.allow",
    ),
    agentPolicy: resolvePolicyLayer(
      resolvedLayers.agentPolicy,
      input.agentId ? `agents.${input.agentId}.tools.allow` : "agent tools.allow",
    ),
    agentProviderPolicy: resolvePolicyLayer(
      resolvedLayers.agentProviderPolicy,
      input.agentId
        ? `agents.${input.agentId}.tools.byProvider.allow`
        : "agent tools.byProvider.allow",
    ),
    groupPolicy: resolvePolicyLayer(
      resolvedLayers.groupPolicy,
      "group tools.allow",
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

  const toolDefinitions = toToolDefinitions({
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
  const toolHarness = splitSdkTools({
    tools: toolDefinitions,
    sandboxEnabled: false,
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
    toolHarness,
    toolRegistry: registry,
    toolLookup,
    artifacts,
    summaries,
  };
}
