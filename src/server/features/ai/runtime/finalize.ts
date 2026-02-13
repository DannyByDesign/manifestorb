import type { OpenWorldTurnResult, RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeLoopResult } from "@/server/features/ai/runtime/response-contract";

function dedupeApprovals(
  approvals: Array<{ id: string; requestPayload?: unknown }>,
): Array<{ id: string; requestPayload?: unknown }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; requestPayload?: unknown }>= [];

  for (const approval of approvals) {
    if (!approval?.id || seen.has(approval.id)) continue;
    seen.add(approval.id);
    out.push(approval);
  }

  return out;
}

export function buildFinalUserResponse(params: {
  session: RuntimeSession;
  loopResult: RuntimeLoopResult;
}): OpenWorldTurnResult {
  const approvals = dedupeApprovals(params.session.artifacts.approvals);
  const interactivePayloads = Array.isArray(params.session.artifacts.interactivePayloads)
    ? params.session.artifacts.interactivePayloads
    : [];

  const finalText = params.loopResult.text.trim().length > 0
    ? params.loopResult.text.trim()
    : "I couldn't complete that request yet. Please clarify the exact output you need.";

  return {
    text: finalText,
    approvals,
    interactivePayloads,
    selectedSkillIds: params.session.skillSnapshot.selectedSkillIds,
    toolSummaries: params.session.summaries,
  };
}
