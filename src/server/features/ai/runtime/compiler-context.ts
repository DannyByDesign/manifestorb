import type { ContextPack, PendingStateContext } from "@/server/features/memory/context-manager";

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function renderPendingState(pending: PendingStateContext | undefined): string | null {
  if (!pending) return null;

  const lines: string[] = [];
  if (pending.scheduleProposal) {
    lines.push(`- pending schedule proposal: ${pending.scheduleProposal.description}`);
    const opts = pending.scheduleProposal.options.slice(0, 6);
    for (let i = 0; i < opts.length; i += 1) {
      const opt = opts[i]!;
      lines.push(`  - option ${i + 1}: ${opt.label ?? opt.start}`);
    }
  }

  const approvals = pending.approvals?.slice(0, 3) ?? [];
  if (approvals.length > 0) {
    lines.push(`- pending approvals: ${approvals.length}`);
    for (const approval of approvals) {
      lines.push(`  - ${approval.tool}: ${approval.description}`);
    }
  }

  if (pending.activeDraft) {
    lines.push(`- active draft: ${pending.activeDraft.summary ?? pending.activeDraft.subject ?? pending.activeDraft.draftId}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export function renderCompilerContextSlice(contextPack: ContextPack | undefined): string | null {
  if (!contextPack) return null;

  // Keep this intentionally small and stable; the compiler should use it only for follow-up resolution.
  const maxTotalChars = 1_800;
  const lines: string[] = [];

  if (contextPack.system.summary) {
    lines.push(`summary: ${clip(contextPack.system.summary, 420)}`);
  }

  const pending = renderPendingState(contextPack.pendingState);
  if (pending) {
    lines.push("pending_state:");
    lines.push(pending);
  }

  const history = contextPack.history ?? [];
  if (history.length > 0) {
    const tail = history.slice(Math.max(0, history.length - 8));
    lines.push("recent_history:");
    for (const msg of tail) {
      const role = msg.role;
      const content = typeof msg.content === "string" ? msg.content : "";
      if (!content.trim()) continue;
      lines.push(`${role}: ${clip(content.trim().replace(/\s+/gu, " "), 260)}`);
    }
  }

  const rendered = lines.join("\n");
  return clip(rendered, maxTotalChars);
}

