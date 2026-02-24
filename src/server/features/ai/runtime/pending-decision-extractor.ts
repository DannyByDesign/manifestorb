import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { Logger } from "@/server/lib/logger";

const pendingDecisionSchema = z
  .object({
    action: z.enum([
      "approve",
      "deny",
      "select_option",
      "choose_earlier",
      "choose_later",
      "none",
    ]),
    optionIndex: z.number().int().min(0).max(99).optional(),
    confidence: z.number().min(0).max(1),
    needsClarification: z.boolean().default(false),
    clarificationPrompt: z.string().min(1).max(220).optional(),
  })
  .strict();

export type PendingDecisionIntent = z.infer<typeof pendingDecisionSchema>;

export async function extractPendingDecisionIntent(params: {
  userId: string;
  emailAccountId: string;
  email: string;
  provider: string;
  message: string;
  hasPendingApproval: boolean;
  hasPendingScheduleProposal: boolean;
  hasPendingAmbiguousTime: boolean;
  scheduleOptionsCount: number;
  logger: Logger;
}): Promise<PendingDecisionIntent> {
  if (
    !params.hasPendingApproval &&
    !params.hasPendingScheduleProposal &&
    !params.hasPendingAmbiguousTime
  ) {
    return {
      action: "none",
      confidence: 1,
      needsClarification: false,
    };
  }

  const modelOptions = getModel("economy");
  const generate = createGenerateObject({
    emailAccount: {
      id: params.emailAccountId,
      email: params.email,
      userId: params.userId,
    },
    label: "openworld-runtime-pending-decision",
    modelOptions,
    maxLLMRetries: 0,
  });

  try {
    const { object } = await generate({
      model: modelOptions.model,
      schema: pendingDecisionSchema,
      system: [
        "You classify user replies to pending approvals and scheduling choices.",
        "Output JSON only matching the schema.",
        "Use select_option only when the user explicitly selects a numbered option.",
        "Use choose_earlier/choose_later only for ambiguous-time requests.",
        "If the message is unrelated or ambiguous, return action none.",
      ].join("\n"),
      prompt: [
        `Provider: ${params.provider}`,
        `Pending generic approval: ${params.hasPendingApproval ? "yes" : "no"}`,
        `Pending schedule proposal: ${params.hasPendingScheduleProposal ? "yes" : "no"}`,
        `Pending ambiguous-time request: ${params.hasPendingAmbiguousTime ? "yes" : "no"}`,
        `Schedule options count: ${params.scheduleOptionsCount}`,
        "User message:",
        params.message.trim(),
      ].join("\n"),
    });
    return object;
  } catch (error) {
    params.logger.warn("Pending-decision extractor failed", {
      error: error instanceof Error ? error.message : String(error),
      provider: params.provider,
      userId: params.userId,
    });
    return {
      action: "none",
      confidence: 0,
      needsClarification: true,
      clarificationPrompt: "Please confirm what you want me to do with the pending request.",
    };
  }
}
