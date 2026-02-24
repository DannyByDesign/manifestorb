import { createCapabilities } from "@/server/features/ai/tools/runtime/capabilities";
import { loadRuntimeSkills } from "@/server/features/ai/skills/loader";
import { buildSkillPromptSnapshot } from "@/server/features/ai/skills/snapshot";
import { filterToolRegistryDetailed } from "@/server/features/ai/tools/fabric/policy-filter";
import { buildRuntimeToolRegistryContext } from "@/server/features/ai/tools/fabric/registry";
import {
  type RuntimeTurnContract,
} from "@/server/features/ai/runtime/turn-contract";
import { resolveEffectiveToolPolicy } from "@/server/features/ai/tools/policy/policy-resolver";
import {
  expandPolicyWithPluginGroups,
  normalizeToolName,
  stripPluginOnlyAllowlist,
} from "@/server/features/ai/tools/policy/tool-policy";
import { getModel } from "@/server/lib/llms/model";
import { assembleRuntimeSessionTools } from "@/server/features/ai/runtime/runtime-tools";
import prisma from "@/server/db/client";
import type { RuntimeSession, OpenWorldTurnInput } from "@/server/features/ai/runtime/types";
import type { ToolExecutionSummary } from "@/server/features/ai/tools/fabric/types";
import { planRuntimeTurn } from "@/server/features/ai/runtime/turn-planner";
import {
  resolveEmailAccount,
  resolveEmailAccountFromMessageHint,
} from "@/server/lib/user-utils";

const SECRETARY_TOOL_PREFIXES = [
  "email.",
  "calendar.",
  "task.",
  "web.",
  "policy.",
] as const;

function isSecretaryCoreTool(toolName: string): boolean {
  return SECRETARY_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

export function resolveRuntimeToolCatalogMaxTools(turn: RuntimeTurnContract): number | undefined {
  if (turn.routeHint === "planner") return 96;
  if (turn.routeHint === "evidence_first") return 48;
  return undefined;
}

export function shouldAdmitDangerousTools(turn: RuntimeTurnContract): boolean {
  return turn.requestedOperation === "mutate" || turn.requestedOperation === "mixed";
}

function stabilizeTurnForExecution(turn: RuntimeTurnContract): RuntimeTurnContract {
  if (turn.requestedOperation !== "read") return turn;

  const next: RuntimeTurnContract = { ...turn };
  if (next.toolChoice === "none") {
    next.toolChoice = "auto";
  }
  if (next.routeHint === "conversation_only") {
    next.routeHint = next.followUpLikely ? "evidence_first" : "planner";
  }
  if (next.followUpLikely && next.routeHint === "planner") {
    next.routeHint = "evidence_first";
  }
  return next;
}

export function requiresExplicitAccountSelection(turn: RuntimeTurnContract): boolean {
  const mutatingOrReading =
    turn.requestedOperation === "read" ||
    turn.requestedOperation === "mutate" ||
    turn.requestedOperation === "mixed";
  if (!mutatingOrReading) return false;

  return (
    turn.domain === "inbox" ||
    turn.domain === "calendar" ||
    turn.domain === "cross_surface"
  );
}

function applyAccountAmbiguityGuard(
  turn: RuntimeTurnContract,
  accountEmails: string[],
): RuntimeTurnContract {
  const accountList = accountEmails.slice(0, 6).join(", ");
  return {
    ...turn,
    requestedOperation: "meta",
    routeHint: "conversation_only",
    toolChoice: "none",
    needsClarification: true,
    followUpLikely: false,
    metaConstraints: [
      ...turn.metaConstraints,
      "multi_account_selection_required",
    ],
    conversationClauses: [
      ...turn.conversationClauses,
      accountList.length > 0
        ? `Ask the user which account to use before inbox/calendar actions. Available accounts: ${accountList}.`
        : "Ask the user which account to use before inbox/calendar actions.",
    ],
  };
}

export async function createRuntimeSession(input: OpenWorldTurnInput): Promise<RuntimeSession> {
  const isSubagentSession = Boolean(
    input.agentId && input.agentId.toLowerCase().includes("subagent"),
  );

  const rawTurn =
    input.runtimeTurnContract ??
    await planRuntimeTurn({
      userId: input.userId,
      emailAccountId: input.emailAccountId,
      email: input.email,
      provider: input.provider,
      message: input.message,
      logger: input.logger,
    });
  const stabilizedTurn = stabilizeTurnForExecution(rawTurn);

  const [userAiConfig, emailAccounts, lastConversationAccount] = await Promise.all([
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
    prisma.emailAccount.findMany({
      where: { userId: input.userId },
      orderBy: { updatedAt: "desc" },
    }),
    input.conversationId
      ? prisma.conversationMessage.findFirst({
          where: {
            conversationId: input.conversationId,
            userId: input.userId,
            emailAccountId: { not: null },
          },
          orderBy: { createdAt: "desc" },
          select: { emailAccountId: true },
        })
      : Promise.resolve(null),
  ]);

  const hintedEmailAccount = resolveEmailAccountFromMessageHint(
    { emailAccounts },
    input.message,
  );
  const preferredEmailAccountId =
    hintedEmailAccount?.id ??
    lastConversationAccount?.emailAccountId ??
    null;
  const explicitAccount = resolveEmailAccount(
    { emailAccounts },
    preferredEmailAccountId,
    { allowImplicit: false },
  );
  const accountAmbiguous = emailAccounts.length > 1 && !explicitAccount;
  const resolvedAccount =
    explicitAccount ??
    resolveEmailAccount(
      { emailAccounts },
      input.emailAccountId,
      { allowImplicit: true },
    );

  if (!resolvedAccount) {
    throw new Error("No email account found for runtime session");
  }

  const resolvedInput: OpenWorldTurnInput = {
    ...input,
    emailAccountId: resolvedAccount.id,
    email: resolvedAccount.email,
  };

  const needsAccountClarification =
    accountAmbiguous && requiresExplicitAccountSelection(stabilizedTurn);
  const turn = needsAccountClarification
    ? applyAccountAmbiguityGuard(
        stabilizedTurn,
        emailAccounts.map((account) => account.email),
      )
    : stabilizedTurn;

  if (needsAccountClarification) {
    resolvedInput.logger.info("Runtime account selection requires clarification", {
      userId: resolvedInput.userId,
      conversationId: resolvedInput.conversationId ?? null,
      candidateCount: emailAccounts.length,
      preferredEmailAccountId: preferredEmailAccountId ?? null,
    });
  }

  const capabilities = await createCapabilities({
    userId: resolvedInput.userId,
    emailAccountId: resolvedInput.emailAccountId,
    email: resolvedInput.email,
    provider: resolvedInput.providerName,
    logger: resolvedInput.logger,
    conversationId: resolvedInput.conversationId,
    currentMessage: resolvedInput.message,
    sourceEmailMessageId: resolvedInput.sourceEmailMessageId,
    sourceEmailThreadId: resolvedInput.sourceEmailThreadId,
  });

  const loadedSkills = loadRuntimeSkills();
  const skillSnapshot = buildSkillPromptSnapshot({
    turn,
    skills: loadedSkills,
  });

  const registryContext = buildRuntimeToolRegistryContext();
  const fullRegistry = registryContext.registry;
  const secretaryRegistry = fullRegistry.filter((definition) =>
    isSecretaryCoreTool(definition.toolName),
  );

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
    agentId: resolvedInput.agentId,
    modelProvider: routingModel.provider,
    modelId: routingModel.modelName,
    groupId: resolvedInput.groupId,
    groupChannel: resolvedInput.groupChannel ?? resolvedInput.provider,
    channelId: resolvedInput.channelId,
  });

  const coreToolNames = new Set(
    secretaryRegistry
      .map((definition) => normalizeToolName(definition.toolName))
      .filter(Boolean),
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
      resolvedInput.logger.warn(`tools: ${label} allowlist contains unknown entries (${entries}). ${suffix}`);
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
      resolvedInput.agentId ? `agents.${resolvedInput.agentId}.tools.allow` : "agent tools.allow",
    ),
    agentProviderPolicy: resolvePolicyLayer(
      resolvedLayers.agentProviderPolicy,
      resolvedInput.agentId
        ? `agents.${resolvedInput.agentId}.tools.byProvider.allow`
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

  const filtered =
    turn.toolChoice === "none"
      ? null
      : await filterToolRegistryDetailed(secretaryRegistry, {
          includeDangerous: shouldAdmitDangerousTools(turn),
          message: resolvedInput.message,
          embeddingEmail: resolvedInput.email,
          turn,
          maxTools: resolveRuntimeToolCatalogMaxTools(turn),
          layeredPolicies,
          additionalGroups: registryContext.additionalGroups,
        });

  const registry = filtered ? filtered.tools : [];

  resolvedInput.logger.info("Runtime tool catalog resolved", {
    toolCountBefore: fullRegistry.length,
    toolCountSecretaryScope: secretaryRegistry.length,
    toolCountAfter: registry.length,
    routeHint: turn.routeHint,
    requestedOperation: turn.requestedOperation,
    toolChoice: turn.toolChoice,
    source: turn.source,
    runtimeEmailAccountId: resolvedInput.emailAccountId,
  });

  const artifacts = {
    approvals: [] as Array<{ id: string; requestPayload?: unknown }>,
    interactivePayloads: [] as unknown[],
  };

  const summaries: ToolExecutionSummary[] = [];

  const assembledTools = assembleRuntimeSessionTools({
    registry,
    context: {
      policy: {
        userId: resolvedInput.userId,
        emailAccountId: resolvedInput.emailAccountId,
        provider: resolvedInput.provider,
        conversationId: resolvedInput.conversationId,
        channelId: resolvedInput.channelId,
        threadId: resolvedInput.threadId,
        messageId: resolvedInput.messageId,
        source: "runtime",
      },
      capabilities,
    },
    artifacts,
    summaries,
  });

  return {
    input: resolvedInput,
    capabilities,
    turn,
    skillSnapshot,
    userPromptConfig: userAiConfig
      ? {
          maxSteps: userAiConfig.maxSteps ?? undefined,
          approvalInstructions: userAiConfig.approvalInstructions ?? undefined,
          customInstructions: userAiConfig.customInstructions ?? undefined,
          conversationCategories: userAiConfig.conversationCategories ?? undefined,
        }
      : undefined,
    tools: assembledTools.tools,
    sessionToolLookup: assembledTools.toolLookup,
    toolRegistry: registry,
    artifacts,
    summaries,
  };
}
