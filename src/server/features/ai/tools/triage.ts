import { z } from "zod";
import { type ToolDefinition } from "./types";
import { triageTasks } from "@/features/tasks/triage/TaskTriageService";

const triageParameters = z.object({
  message: z.string().optional(),
});

export const triageTool: ToolDefinition<typeof triageParameters> = {
  name: "triage",
  description:
    "Rank the user's tasks and suggest what to do next with rationale.",
  parameters: triageParameters,
  securityLevel: "SAFE",
  execute: async ({ message }, context) => {
    const result = await triageTasks({
      userId: context.userId,
      emailAccountId: context.emailAccountId,
      logger: context.logger,
      messageContent: message,
    });

    return {
      success: true,
      data: result,
    };
  },
};
