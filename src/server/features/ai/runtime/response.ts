import type { OpenWorldTurnResult, RuntimeSession } from "@/server/features/ai/runtime/types";

function dedupeApprovals(
  approvals: Array<{ id: string; requestPayload?: unknown }>,
): Array<{ id: string; requestPayload?: unknown }> {
  const out: Array<{ id: string; requestPayload?: unknown }> = [];
  const seen = new Set<string>();
  for (const approval of approvals) {
    if (!approval?.id || seen.has(approval.id)) continue;
    seen.add(approval.id);
    out.push(approval);
  }
  return out;
}

export function finalizeRuntimeResult(params: {
  session: RuntimeSession;
  text: string;
}): OpenWorldTurnResult {
  const text = params.text.trim().length > 0
    ? params.text.trim()
    : "I couldn't complete that request yet. Please clarify the exact output you need.";

  const approvals = dedupeApprovals(params.session.artifacts.approvals);
  const interactivePayloads = Array.isArray(params.session.artifacts.interactivePayloads)
    ? params.session.artifacts.interactivePayloads
    : [];

  const finalText =
    approvals.length > 0 && !/approval/iu.test(text)
      ? `${text}\n\nSome requested actions require approval before I can execute them.`
      : text;

  return {
    text: finalText,
    approvals,
    interactivePayloads,
    selectedSkillIds: params.session.skillSnapshot.selectedSkillIds,
    toolSummaries: params.session.summaries,
  };
}
