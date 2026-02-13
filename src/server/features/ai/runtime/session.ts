import { createCapabilities } from "@/server/features/ai/capabilities";
import { loadRuntimeSkills } from "@/server/features/ai/skills/loader";
import { buildSkillPromptSnapshot } from "@/server/features/ai/skills/snapshot";
import { assembleRuntimeTools } from "@/server/features/ai/tools/fabric/assembler";
import { filterToolRegistry } from "@/server/features/ai/tools/fabric/policy-filter";
import { buildRuntimeToolRegistry } from "@/server/features/ai/tools/fabric/registry";
import type { RuntimeSession, OpenWorldTurnInput } from "@/server/features/ai/runtime/types";
import type { ToolExecutionSummary } from "@/server/features/ai/tools/fabric/types";

export async function createRuntimeSession(input: OpenWorldTurnInput): Promise<RuntimeSession> {
  const capabilities = await createCapabilities({
    userId: input.userId,
    emailAccountId: input.emailAccountId,
    email: input.email,
    provider: input.providerName,
    logger: input.logger,
    conversationId: input.conversationId,
    currentMessage: input.message,
    sourceEmailMessageId: input.sourceEmailMessageId,
    sourceEmailThreadId: input.sourceEmailThreadId,
  });

  const loadedSkills = loadRuntimeSkills();
  const skillSnapshot = buildSkillPromptSnapshot({
    message: input.message,
    skills: loadedSkills,
  });

  const registry = filterToolRegistry(buildRuntimeToolRegistry(), {
    includeDangerous: true,
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
        source: "planner",
      },
      capabilities,
    },
    artifacts,
    summaries,
  });

  return {
    input,
    capabilities,
    skillSnapshot,
    tools,
    toolRegistry: registry,
    artifacts,
    summaries,
  };
}
