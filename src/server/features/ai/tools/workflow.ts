import { z } from "zod";
import { type ToolDefinition } from "./types";
import { executeTool } from "./executor";
import { createTool } from "./create";
import { modifyTool } from "./modify";
import { queryTool } from "./query";
import { deleteTool } from "./delete";
import { requiresApproval } from "@/features/approvals/policy";

const workflowStep = z.object({
    action: z.enum(["create", "modify", "query", "delete"]),
    resource: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
    ids: z.array(z.string()).optional(),
    changes: z.record(z.string(), z.unknown()).optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
    dependsOn: z.number().optional().describe("0-based index of a previous step whose output should be available as context"),
    runIf: z
        .object({
            dependsOn: z.number().describe("0-based index of a previous step to inspect."),
            operator: z
                .enum(["success", "failure", "has_results", "no_results"])
                .default("success")
                .describe("Condition used to decide whether this step should run."),
        })
        .optional()
        .describe("Optional conditional gate for this step."),
});

const workflowParameters = z.object({
    steps: z.array(workflowStep).min(2).max(5).describe("Array of steps to execute in order"),
    onFailure: z
        .enum(["none", "plan_compensation", "auto_compensate"])
        .default("plan_compensation")
        .describe("Failure mode: none (stop), plan_compensation (return reversible recovery steps), auto_compensate (attempt rollback)."),
    preApproved: z
        .boolean()
        .optional()
        .describe("Internal flag used by approval execution path. Do not set manually."),
    approvalId: z
        .string()
        .optional()
        .describe("Internal approval identifier used when preApproved=true."),
});

export const workflowTool: ToolDefinition<typeof workflowParameters> = {
    name: "workflow",
    description: `Execute a multi-step workflow. Use when you need related actions across different resources in a single step.

Examples:
- Create a task and block calendar time: [{ action: "create", resource: "task", data: { title: "..." } }, { action: "create", resource: "calendar", data: { title: "Work on: ...", autoSchedule: true } }]
- Reply to email and create follow-up task: [{ action: "create", resource: "email", data: { ... } }, { action: "create", resource: "task", data: { ... } }]
- Conditional branch: query availability, then run fallback step only when no slots are found using runIf: { dependsOn: 0, operator: "no_results" }

Steps run sequentially. If a step fails, later steps are skipped.`,

    parameters: workflowParameters,

    execute: async ({ steps, onFailure, preApproved }, context) => {
        type WorkflowAction = "create" | "modify" | "query" | "delete";
type WorkflowStepResult = {
            step: number;
            action: WorkflowAction;
            resource: string;
            dependsOn?: number;
            success: boolean;
            skipped?: boolean;
            outputIds: string[];
            itemCount: number;
            data?: unknown;
            error?: string;
        };
        type CompensationPlanStep = {
            sourceStep: number;
            action: "delete";
            resource: string;
            ids: string[];
        };

        const results: WorkflowStepResult[] = [];
        const tools = { create: createTool, modify: modifyTool, query: queryTool, delete: deleteTool } as const;
        const compensationCandidates: CompensationPlanStep[] = [];
        const reversibleCreateResources = new Set(["task", "calendar", "draft", "knowledge", "automation"]);

        const extractIdsFromToolResult = (result: unknown): string[] => {
            if (!result || typeof result !== "object") return [];
            const payload = (result as { data?: unknown }).data;
            if (!Array.isArray(payload)) return [];
            return payload
                .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : undefined))
                .filter((id): id is string => typeof id === "string" && id.length > 0);
        };
        const inferItemCount = (result: unknown): number => {
            if (!result || typeof result !== "object") return 0;
            const payload = (result as { data?: unknown }).data;
            if (Array.isArray(payload)) return payload.length;
            if (payload && typeof payload === "object" && "count" in payload) {
                const count = (payload as { count?: unknown }).count;
                if (typeof count === "number" && Number.isFinite(count)) return count;
            }
            return 0;
        };
        const buildCompensationPlan = (): CompensationPlanStep[] => [...compensationCandidates].reverse();
        const executeCompensationPlan = async (plan: CompensationPlanStep[]) => {
            const results: Array<CompensationPlanStep & { success: boolean; error?: string }> = [];
            for (const step of plan) {
                try {
                    const compensationResult = await executeTool(
                        deleteTool,
                        { resource: step.resource, ids: step.ids },
                        context
                    );
                    results.push({
                        ...step,
                        success: compensationResult.success === true,
                        ...(compensationResult.success === true ? {} : { error: compensationResult.error ?? "Unknown compensation failure" }),
                    });
                } catch (error) {
                    results.push({
                        ...step,
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            return results;
        };

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i]!;
            const tool = tools[step.action];
            if (!tool) {
                results.push({
                    step: i,
                    action: step.action,
                    resource: step.resource,
                    dependsOn: step.dependsOn,
                    success: false,
                    outputIds: [],
                    itemCount: 0,
                    error: `Unknown action: ${step.action}`,
                });
                break;
            }
            try {
                if (step.runIf) {
                    const conditionStep = step.runIf.dependsOn;
                    if (conditionStep < 0 || conditionStep >= i) {
                        results.push({
                            step: i,
                            action: step.action,
                            resource: step.resource,
                            dependsOn: step.dependsOn,
                            success: false,
                            outputIds: [],
                            itemCount: 0,
                            error: `Invalid runIf.dependsOn index ${conditionStep}; must reference an earlier step.`,
                        });
                        break;
                    }

                    const parent = results.find((r) => r.step === conditionStep);
                    if (!parent) {
                        results.push({
                            step: i,
                            action: step.action,
                            resource: step.resource,
                            dependsOn: step.dependsOn,
                            success: false,
                            outputIds: [],
                            itemCount: 0,
                            error: `runIf dependency step ${conditionStep} not found.`,
                        });
                        break;
                    }

                    const operator = step.runIf.operator ?? "success";
                    const hasResults = parent.itemCount > 0 || parent.outputIds.length > 0;
                    const shouldRun =
                        operator === "success"
                            ? parent.success
                            : operator === "failure"
                                ? !parent.success
                                : operator === "has_results"
                                    ? hasResults
                                    : !hasResults;

                    if (!shouldRun) {
                        results.push({
                            step: i,
                            action: step.action,
                            resource: step.resource,
                            dependsOn: step.dependsOn,
                            success: true,
                            skipped: true,
                            outputIds: [],
                            itemCount: 0,
                            data: { skippedBecause: { step: conditionStep, operator } },
                        });
                        continue;
                    }
                }

                let dependencyResult: unknown;
                if (typeof step.dependsOn === "number") {
                    if (step.dependsOn < 0 || step.dependsOn >= i) {
                        results.push({
                            step: i,
                            action: step.action,
                            resource: step.resource,
                            dependsOn: step.dependsOn,
                            success: false,
                            outputIds: [],
                            itemCount: 0,
                            error: `Invalid dependsOn index ${step.dependsOn}; must reference an earlier step.`,
                        });
                        break;
                    }
                    const parent = results.find((r) => r.step === step.dependsOn);
                    if (!parent || !parent.success) {
                        results.push({
                            step: i,
                            action: step.action,
                            resource: step.resource,
                            dependsOn: step.dependsOn,
                            success: false,
                            outputIds: [],
                            itemCount: 0,
                            error: `Dependency step ${step.dependsOn} did not complete successfully.`,
                        });
                        break;
                    }
                    dependencyResult = parent.data;
                }

                const args: Record<string, unknown> = { resource: step.resource };
                if (step.data != null) args.data = step.data;
                if (step.ids != null) {
                    args.ids = step.ids;
                } else if ((step.action === "modify" || step.action === "delete") && dependencyResult != null) {
                    const inferredIds = extractIdsFromToolResult(dependencyResult);
                    if (inferredIds.length > 0) {
                        args.ids = inferredIds;
                    }
                }
                if (step.changes != null) args.changes = step.changes;
                if (step.filter != null) args.filter = step.filter;

                // Workflow must not bypass per-tool approval policy.
                if (!preApproved) {
                    const needsApproval = await requiresApproval({
                        userId: context.userId,
                        toolName: step.action,
                        args,
                    });
                    if (needsApproval) {
                        results.push({
                            step: i,
                            action: step.action,
                            resource: step.resource,
                            dependsOn: step.dependsOn,
                            success: false,
                            outputIds: [],
                            itemCount: 0,
                            error: `Step requires approval before executing '${step.action}'.`,
                        });
                        break;
                    }
                }

                if ((step.action === "modify" || step.action === "delete") && !Array.isArray(args.ids)) {
                    results.push({
                        step: i,
                        action: step.action,
                        resource: step.resource,
                        dependsOn: step.dependsOn,
                        success: false,
                        outputIds: [],
                        itemCount: 0,
                        error: "This step requires ids (or a dependsOn step that returns item ids).",
                    });
                    break;
                }
                const result = await executeTool(
                    tool as any,
                    args as any,
                    context,
                );
                const resultIds = extractIdsFromToolResult(result);
                const fallbackIds =
                    resultIds.length > 0
                        ? resultIds
                        : Array.isArray(args.ids)
                            ? (args.ids as string[])
                            : [];
                if (
                    result.success === true &&
                    step.action === "create" &&
                    reversibleCreateResources.has(step.resource) &&
                    resultIds.length > 0
                ) {
                    compensationCandidates.push({
                        sourceStep: i,
                        action: "delete",
                        resource: step.resource,
                        ids: resultIds,
                    });
                }
                results.push({
                    step: i,
                    action: step.action,
                    resource: step.resource,
                    dependsOn: step.dependsOn,
                    success: result.success === true,
                    outputIds: fallbackIds,
                    itemCount: inferItemCount(result),
                    data: result,
                });
                if (result.success !== true) break;
            } catch (err) {
                results.push({
                    step: i,
                    action: step.action,
                    resource: step.resource,
                    dependsOn: step.dependsOn,
                    success: false,
                    outputIds: [],
                    itemCount: 0,
                    error: err instanceof Error ? err.message : String(err),
                });
                break;
            }
        }

        const success = results.every((r) => r.success);
        const compensationPlan = !success && onFailure !== "none" ? buildCompensationPlan() : [];
        const compensationResults =
            !success && onFailure === "auto_compensate" ? await executeCompensationPlan(compensationPlan) : [];

        return {
            success,
            data: {
                steps: results,
                compensation: {
                    attempted: onFailure === "auto_compensate" && !success,
                    planned: compensationPlan,
                    results: compensationResults,
                },
            },
            message: `Executed ${results.filter((r) => r.success).length}/${steps.length} steps.`,
        };
    },

    securityLevel: "CAUTION",
};
