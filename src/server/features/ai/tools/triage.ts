import { z } from "zod";
import { type ToolDefinition } from "./types";
import { triageTasks } from "@/features/tasks/triage/TaskTriageService";

export const triageTool: ToolDefinition<any> = {
  name: "triage",
  description:
    "Rank the user's tasks and suggest what to do next with rationale.",
  parameters: z.object({
    message: z.string().optional(),
  }),
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
