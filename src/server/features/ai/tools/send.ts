import { z } from "zod";
import { type ToolDefinition } from "./types";

export const sendTool: ToolDefinition<any> = {
  name: "send",
  description:
    "Send an email draft. DANGEROUS: requires explicit user approval.",
  parameters: z.object({
    draftId: z.string().min(1),
  }),
  securityLevel: "DANGEROUS",
  execute: async ({ draftId }, { providers }) => {
    const result = await providers.email.sendDraft(draftId);
    return {
      success: true,
      data: result,
      message: "Email sent.",
    };
  },
};
