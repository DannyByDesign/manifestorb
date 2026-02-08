import { z } from "zod";
import { type ToolDefinition } from "./types";
import { sendDraftById } from "@/features/drafts/operations";

const sendParameters = z.object({
  draftId: z.string().min(1),
});

export const sendTool: ToolDefinition<typeof sendParameters> = {
  name: "send",
  description:
    "Send an email draft. DANGEROUS: requires explicit user approval.",
  parameters: sendParameters,
  securityLevel: "DANGEROUS",
  execute: async ({ draftId }, { providers }) => {
    const result = await sendDraftById({
      provider: providers.email,
      draftId,
      requireExisting: true,
    });
    return {
      success: true,
      data: result,
      message: "Email sent.",
    };
  },
};
