import { z } from "zod";

export const runtimeDecisionSchema = z
  .object({
    type: z.enum(["tool_call", "respond", "clarify"]),
    toolName: z.string().min(1).optional(),
    argsJson: z.string().min(2).max(12000).optional(),
    responseText: z.string().min(1).max(4000).optional(),
    rationale: z.string().max(320).optional(),
  })
  .strict();

export type RuntimeDecision = z.infer<typeof runtimeDecisionSchema>;

export interface ValidatedToolDecision {
  type: "tool_call";
  toolName: string;
  args: Record<string, unknown>;
  rationale?: string;
}
