import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { runRuntimeAttempt } from "@/server/features/ai/runtime/attempt";

export async function runRuntimeLoop(session: RuntimeSession): Promise<{ text: string }> {
  try {
    return await runRuntimeAttempt(session);
  } catch (error) {
    session.input.logger.error("Open-world runtime attempt failed", { error });

    const fallbackGenerate = createGenerateText({
      emailAccount: {
        id: session.input.emailAccountId,
        email: session.input.email,
        userId: session.input.userId,
      },
      label: "openworld-runtime-fallback-chat",
      modelOptions: getModel("chat"),
    });

    const fallback = await fallbackGenerate({
      model: getModel("chat").model,
      system:
        "You are Amodel. The tool runtime failed. Briefly explain the failure and ask the user to retry with a concise request.",
      prompt: session.input.message,
    });

    return {
      text:
        fallback.text?.trim() ||
        "I hit a runtime issue while executing that. Please retry the request in one sentence.",
    };
  }
}
