import { z } from "zod";
import { type ToolDefinition } from "./types";
import { executeTool } from "./executor";
import { createTool } from "./create";
import { modifyTool } from "./modify";
import { queryTool } from "./query";
import { deleteTool } from "./delete";

const workflowStep = z.object({
    action: z.enum(["create", "modify", "query", "delete"]),
    resource: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
    ids: z.array(z.string()).optional(),
    changes: z.record(z.string(), z.unknown()).optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
    dependsOn: z.number().optional().describe("0-based index of a previous step whose output should be available as context"),
});

const workflowParameters = z.object({
    steps: z.array(workflowStep).min(2).max(5).describe("Array of steps to execute in order"),
});

export const workflowTool: ToolDefinition<z.infer<typeof workflowParameters>> = {
    name: "workflow",
    description: `Execute a multi-step workflow. Use when you need related actions across different resources in a single step.

Examples:
- Create a task and block calendar time: [{ action: "create", resource: "task", data: { title: "..." } }, { action: "create", resource: "calendar", data: { title: "Work on: ...", autoSchedule: true } }]
- Reply to email and create follow-up task: [{ action: "create", resource: "email", data: { ... } }, { action: "create", resource: "task", data: { ... } }]

Steps run sequentially. If a step fails, later steps are skipped.`,

    parameters: workflowParameters,

    execute: async ({ steps }, context) => {
        const results: Array<{ step: number; success: boolean; data?: unknown; error?: string }> = [];
        const tools = { create: createTool, modify: modifyTool, query: queryTool, delete: deleteTool } as const;

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i]!;
            const tool = tools[step.action];
            if (!tool) {
                results.push({ step: i, success: false, error: `Unknown action: ${step.action}` });
                break;
            }
            try {
                const args: Record<string, unknown> = { resource: step.resource };
                if (step.data != null) args.data = step.data;
                if (step.ids != null) args.ids = step.ids;
                if (step.changes != null) args.changes = step.changes;
                if (step.filter != null) args.filter = step.filter;
                const result = await executeTool(tool, args, context);
                results.push({ step: i, success: result.success === true, data: result });
                if (result.success !== true) break;
            } catch (err) {
                results.push({
                    step: i,
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                });
                break;
            }
        }

        return {
            success: results.every((r) => r.success),
            data: results,
            message: `Executed ${results.filter((r) => r.success).length}/${steps.length} steps.`,
        };
    },

    securityLevel: "CAUTION",
};
