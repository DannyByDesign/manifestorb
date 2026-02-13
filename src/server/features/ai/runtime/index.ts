import { createRuntimeSession } from "@/server/features/ai/runtime/session";
import { runRuntimeLoop } from "@/server/features/ai/runtime/loop";
import { finalizeRuntimeResult } from "@/server/features/ai/runtime/response";
import type { OpenWorldTurnInput, OpenWorldTurnResult } from "@/server/features/ai/runtime/types";
import { runRuntimePrecheck } from "@/server/features/ai/runtime/context/precheck";
import { hydrateRuntimeContext } from "@/server/features/ai/runtime/context/hydrator";

export async function runOpenWorldRuntimeTurn(
  input: OpenWorldTurnInput,
): Promise<OpenWorldTurnResult> {
  const precheck = runRuntimePrecheck(input);
  if (!precheck.ok) {
    return {
      text:
        precheck.userMessage ??
        "I’m missing required context to execute that request.",
      approvals: [],
      interactivePayloads: [],
      selectedSkillIds: [],
      toolSummaries: [],
    };
  }

  const hydrated = await hydrateRuntimeContext(input);
  const session = await createRuntimeSession({
    ...input,
    message: hydrated.message,
  });
  const execution = await runRuntimeLoop(session);
  return finalizeRuntimeResult({
    session,
    text: execution.text,
  });
}
