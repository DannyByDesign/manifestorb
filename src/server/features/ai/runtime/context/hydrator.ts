import type { OpenWorldTurnInput } from "@/server/features/ai/runtime/types";

export interface RuntimeHydratedContext {
  message: string;
}

export async function hydrateRuntimeContext(
  input: OpenWorldTurnInput,
): Promise<RuntimeHydratedContext> {
  return {
    message: input.message.trim(),
  };
}
