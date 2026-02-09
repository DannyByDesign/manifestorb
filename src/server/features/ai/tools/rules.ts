import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { createRule, partialUpdateRule, updateRuleActions } from "@/features/rules/rule";
import { mapRuleActionsForMutation } from "@/features/rules/action-mapper";
import { saveLearnedPatterns } from "@/features/rules/learned-patterns";
import { GroupItemType, LogicalOperator, ActionType } from "@/generated/prisma/enums";
import { delayInMinutesSchema } from "@/actions/rule.validation";
import { filterNullProperties } from "@/server/lib";
import { isMicrosoftProvider } from "@/features/email/provider-types";
import {
  disableApprovalRule,
  enableApprovalRule,
  getApprovalOperationLabel,
  listApprovalOperationKeys,
  normalizeApprovalOperationKey,
  listApprovalRuleConfigs,
  removeApprovalRule,
  renameApprovalRule,
  resolveApprovalRuleReference,
  resetApprovalRuleConfig,
  setApprovalToolDefaultPolicy,
  upsertApprovalRule,
  type ApprovalPolicy,
} from "@/features/approvals/rules";
import {
  enableEmailRule,
  listEmailRules,
  renameEmailRule,
  resolveEmailRuleReference,
  resumePausedEmailRules,
  temporarilyDisableEmailRule,
} from "@/features/rules/management";
import { updateAccountAbout } from "@/features/preferences/service";

const actionSchema = z.enum([
  "list",
  "get_patterns",
  "create",
  "update_conditions",
  "update_actions",
  "update_patterns",
  "update_about",
  "add_knowledge",
  "list_approval_rules",
  "list_approval_operations",
  "set_approval_rule",
  "remove_approval_rule",
  "set_approval_default",
  "reset_approval_rules",
  "disable",
  "enable",
  "delete",
  "rename",
]);

const updateRuleConditionSchema = z.object({
  ruleName: z.string(),
  condition: z.object({
    aiInstructions: z.string().optional(),
    static: z
      .object({
        from: z.string().nullish(),
        to: z.string().nullish(),
        subject: z.string().nullish(),
      })
      .nullish(),
    conditionalOperator: z
      .enum([LogicalOperator.AND, LogicalOperator.OR])
      .nullish(),
    group: z.string().nullish(),
  }),
});

const updateRuleActionSchema = z.object({
  ruleName: z.string(),
  actions: z.array(
    z.object({
      type: z.enum([
        ActionType.ARCHIVE,
        ActionType.LABEL,
        ActionType.DRAFT_EMAIL,
        ActionType.FORWARD,
        ActionType.REPLY,
        ActionType.SEND_EMAIL,
        ActionType.MARK_READ,
        ActionType.MARK_SPAM,
        ActionType.CALL_WEBHOOK,
        ActionType.DIGEST,
      ]),
      fields: z.object({
        label: z.string().nullish(),
        content: z.string().nullish(),
        webhookUrl: z.string().nullish(),
        to: z.string().nullish(),
        cc: z.string().nullish(),
        bcc: z.string().nullish(),
        subject: z.string().nullish(),
        folderName: z.string().nullish(),
        payload: z.unknown().nullish(),
      }),
      delayInMinutes: delayInMinutesSchema,
    }),
  ),
});

const updateLearnedPatternsSchema = z.object({
  ruleName: z.string(),
  learnedPatterns: z
    .array(
      z.object({
        include: z
          .object({
            from: z.string().optional(),
            subject: z.string().optional(),
          })
          .optional(),
        exclude: z
          .object({
            from: z.string().optional(),
            subject: z.string().optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

const updateAboutSchema = z.object({
  about: z.string().min(1),
});

const addKnowledgeSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

const approvalPolicySchema = z.enum([
  "always",
  "never",
  "conditional",
]);

const approvalRuleConditionsSchema = z
  .object({
    externalOnly: z.boolean().optional(),
    domains: z.array(z.string()).optional(),
    minItemCount: z.number().int().min(0).optional(),
    maxItemCount: z.number().int().min(0).optional(),
  })
  .strict();

const setApprovalRuleSchema = z.object({
  toolName: z.string().min(1),
  ruleId: z.string().optional(),
  name: z.string().optional(),
  policy: approvalPolicySchema,
  resource: z.string().optional(),
  operation: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  conditions: approvalRuleConditionsSchema.optional(),
});

const removeApprovalRuleSchema = z.object({
  toolName: z.string().min(1),
  ruleId: z.string().min(1),
});

const setApprovalDefaultSchema = z.object({
  toolName: z.string().min(1),
  defaultPolicy: approvalPolicySchema,
  defaultConditions: approvalRuleConditionsSchema.optional(),
});

const resetApprovalRulesSchema = z.object({
  toolName: z.string().optional(),
});

const listRulesPayloadSchema = z.object({
  kind: z.enum(["all", "email", "approval"]).optional(),
  query: z.string().optional(),
  includeIds: z.boolean().optional(),
  verbose: z.boolean().optional(),
});

const lifecyclePayloadSchema = z.object({
  kind: z.enum(["email", "approval"]).optional(),
  ruleId: z.string().optional(),
  ruleName: z.string().optional(),
  confirm: z.boolean().optional(),
  durationHours: z.number().positive().max(24 * 30).optional(),
  until: z.string().optional(),
  newName: z.string().optional(),
  toolName: z.string().optional(),
});

const rulesToolParameters = z.object({
  action: actionSchema,
  payload: z.record(z.string(), z.unknown()).optional(),
});

const RULE_QUERY_SYNONYMS: Record<string, string[]> = {
  approval: ["approval", "approve", "permission", "confirm", "safety", "ask first"],
  email: ["email", "inbox", "auto", "archive", "label", "sender", "unsubscribe"],
};

function includesLoose(haystack: string, needle: string): boolean {
  const lhs = haystack.toLowerCase();
  const rhs = needle.toLowerCase().trim();
  if (!rhs) return true;
  if (lhs.includes(rhs)) return true;
  const rhsTokens = rhs.split(/[^a-z0-9]+/u).filter(Boolean);
  if (rhsTokens.length === 0) return false;
  const lhsTokens = lhs.split(/[^a-z0-9]+/u).filter(Boolean);
  const matched = rhsTokens.filter((token) =>
    lhsTokens.some((candidate) => candidate.includes(token) || token.includes(candidate)),
  );
  return matched.length >= Math.max(1, Math.ceil(rhsTokens.length * 0.6));
}

function inferKindFromQuery(query: string | undefined): "all" | "email" | "approval" {
  if (!query?.trim()) return "all";
  const lower = query.toLowerCase();
  const approvalHit = RULE_QUERY_SYNONYMS.approval.some((term) => lower.includes(term));
  const emailHit = RULE_QUERY_SYNONYMS.email.some((term) => lower.includes(term));
  if (approvalHit && !emailHit) return "approval";
  if (emailHit && !approvalHit) return "email";
  return "all";
}

function parseDisableUntil(payload: {
  until?: string;
  durationHours?: number;
}): Date | null {
  if (payload.until) {
    const parsed = new Date(payload.until);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
      return parsed;
    }
  }
  if (typeof payload.durationHours === "number" && Number.isFinite(payload.durationHours)) {
    const millis = Math.floor(payload.durationHours * 60 * 60 * 1000);
    if (millis > 0) return new Date(Date.now() + millis);
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

type LifecycleRuleCandidate =
  | {
      kind: "email";
      id: string;
      name: string;
    }
  | {
      kind: "approval";
      id: string;
      name: string;
      toolName: string;
    };

type LifecycleRuleResolution =
  | {
      status: "none";
      candidates: [];
    }
  | {
      status: "resolved";
      candidate: LifecycleRuleCandidate;
      candidates: [LifecycleRuleCandidate];
    }
  | {
      status: "ambiguous";
      candidates: LifecycleRuleCandidate[];
    };

function mapLifecycleConfirmationCandidates(
  candidates: LifecycleRuleCandidate[],
) {
  return candidates.map((candidate) => {
    if (candidate.kind === "approval") {
      return {
        kind: candidate.kind,
        name: candidate.name,
        toolName: candidate.toolName,
        id: candidate.id,
      };
    }
    return {
      kind: candidate.kind,
      name: candidate.name,
      id: candidate.id,
    };
  });
}

async function resolveLifecycleRule(params: {
  userId: string;
  emailAccountId: string;
  kind?: "email" | "approval";
  ruleId?: string;
  ruleName?: string;
  toolName?: string;
}): Promise<LifecycleRuleResolution> {
  const resolveEmail = async (): Promise<LifecycleRuleResolution> => {
    const resolution = await resolveEmailRuleReference({
      emailAccountId: params.emailAccountId,
      reference: {
        id: params.ruleId,
        name: params.ruleName,
      },
    });
    if (resolution.status === "none") return { status: "none", candidates: [] };
    if (resolution.status === "ambiguous") {
      return {
        status: "ambiguous",
        candidates: resolution.matches.map((match) => ({
          kind: "email",
          id: match.id,
          name: match.name,
        })),
      };
    }
    const selected = resolution.matches[0]!;
    return {
      status: "resolved",
      candidate: {
        kind: "email",
        id: selected.id,
        name: selected.name,
      },
      candidates: [
        {
          kind: "email",
          id: selected.id,
          name: selected.name,
        },
      ],
    };
  };

  const resolveApproval = async (): Promise<LifecycleRuleResolution> => {
    const resolution = await resolveApprovalRuleReference({
      userId: params.userId,
      reference: {
        id: params.ruleId,
        name: params.ruleName,
        toolName: params.toolName,
      },
    });
    if (resolution.status === "none") return { status: "none", candidates: [] };
    if (resolution.status === "ambiguous") {
      return {
        status: "ambiguous",
        candidates: resolution.matches.map((match) => ({
          kind: "approval",
          id: match.rule.id,
          name: match.rule.name,
          toolName: match.toolName,
        })),
      };
    }
    const selected = resolution.matches[0]!;
    return {
      status: "resolved",
      candidate: {
        kind: "approval",
        id: selected.rule.id,
        name: selected.rule.name,
        toolName: selected.toolName,
      },
      candidates: [
        {
          kind: "approval",
          id: selected.rule.id,
          name: selected.rule.name,
          toolName: selected.toolName,
        },
      ],
    };
  };

  if (params.kind === "email") return resolveEmail();
  if (params.kind === "approval") return resolveApproval();

  const [emailResolution, approvalResolution] = await Promise.all([
    resolveEmail(),
    resolveApproval(),
  ]);

  const ambiguousCandidates = [
    ...(emailResolution.status === "ambiguous" ? emailResolution.candidates : []),
    ...(approvalResolution.status === "ambiguous" ? approvalResolution.candidates : []),
  ];
  if (ambiguousCandidates.length > 0) {
    return { status: "ambiguous", candidates: ambiguousCandidates };
  }

  const resolvedCandidates = [
    ...(emailResolution.status === "resolved" ? emailResolution.candidates : []),
    ...(approvalResolution.status === "resolved" ? approvalResolution.candidates : []),
  ];
  if (resolvedCandidates.length === 0) {
    return { status: "none", candidates: [] };
  }
  if (resolvedCandidates.length > 1) {
    return { status: "ambiguous", candidates: resolvedCandidates };
  }

  return {
    status: "resolved",
    candidate: resolvedCandidates[0]!,
    candidates: [resolvedCandidates[0]!],
  };
}


export const rulesTool: ToolDefinition<typeof rulesToolParameters> = {
  name: "rules",
  description: `Manage email and approval rules. Actions: list, create, update_conditions, update_actions, update_patterns, get_patterns, update_about, add_knowledge, list_approval_rules, list_approval_operations, set_approval_rule, remove_approval_rule, set_approval_default, reset_approval_rules, disable, enable, delete, rename.
Rule structure: condition (aiInstructions and/or static from/to/subject) + actions (archive, label, draft, reply, send, mark read, etc.). Static conditions use AND; top-level conditions can use AND/OR (conditionalOperator). Use {{variables}} in action fields for AI-generated content. Prefer short rule names (e.g. Newsletters, Urgent). Check if a rule already exists before creating.`,
  parameters: rulesToolParameters,
  securityLevel: "CAUTION",
  execute: async ({ action, payload }, context) => {
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: context.emailAccountId },
      include: { account: true },
    });
    if (!emailAccount) {
      return { success: false, error: "Email account not found" };
    }

    const provider = emailAccount.account?.provider || "google";

    switch (action) {
      case "list": {
        const parsedListPayload = listRulesPayloadSchema.safeParse(payload ?? {});
        if (!parsedListPayload.success) {
          return { success: false, error: "Invalid payload", data: parsedListPayload.error };
        }
        const listPayload = parsedListPayload.data;
        await resumePausedEmailRules(context.emailAccountId);

        const [account, rawEmailRules, approvalConfigs] = await Promise.all([
          prisma.emailAccount.findUnique({
            where: { id: context.emailAccountId },
            select: { about: true },
          }),
          listEmailRules(context.emailAccountId),
          listApprovalRuleConfigs({ userId: context.userId }),
        ]);
        const effectiveKind = listPayload.kind ?? inferKindFromQuery(listPayload.query);
        const includeIds = listPayload.includeIds === true;
        const verbose = listPayload.verbose === true;

        const mappedEmailRules = rawEmailRules.map((rule) => {
          const staticFilter = filterNullProperties({
            from: rule.from,
            to: rule.to,
            subject: rule.subject,
          });
          const staticConditions =
            Object.keys(staticFilter).length > 0 ? staticFilter : undefined;
          return {
            ...(includeIds ? { id: rule.id } : {}),
            name: rule.name,
            conditions: {
              aiInstructions: rule.instructions,
              static: staticConditions,
              conditionalOperator:
                rule.instructions && staticConditions
                  ? rule.conditionalOperator
                  : undefined,
              group: rule.group?.name,
            },
            actions: rule.actions.map((actionItem) => ({
              type: actionItem.type,
              fields: filterNullProperties({
                label: actionItem.label,
                content: actionItem.content,
                to: actionItem.to,
                cc: actionItem.cc,
                bcc: actionItem.bcc,
                subject: actionItem.subject,
                url: actionItem.url,
                folderName: actionItem.folderName,
              }),
            })),
            enabled: rule.enabled,
            runOnThreads: rule.runOnThreads,
            pausedUntil:
              !rule.enabled && rule.expiresAt && rule.expiresAt.getTime() > Date.now()
                ? rule.expiresAt.toISOString()
                : undefined,
          };
        });

        const mappedApprovalRules = approvalConfigs.flatMap((config) =>
          config.rules.map((rule) => ({
            ...(includeIds ? { id: rule.id } : {}),
            name: rule.name,
            toolName: config.toolName,
            ...(verbose ? { operation: rule.operation } : {}),
            operationLabel: getApprovalOperationLabel(rule.operation ?? "unknown"),
            policy: rule.policy,
            enabled: rule.enabled ?? true,
            pausedUntil: rule.disabledUntil,
            conditions: rule.conditions,
            priority: rule.priority ?? 0,
          })),
        );

        const query = listPayload.query?.trim();
        const filteredEmailRules = !query
          ? mappedEmailRules
          : mappedEmailRules.filter((rule) =>
              includesLoose(
                [
                  rule.name,
                  rule.conditions.aiInstructions ?? "",
                  rule.conditions.group ?? "",
                  ...rule.actions.map((a) => `${a.type} ${JSON.stringify(a.fields ?? {})}`),
                ].join(" "),
                query,
              ),
            );
        const filteredApprovalRules = !query
          ? mappedApprovalRules
          : mappedApprovalRules.filter((rule) =>
              includesLoose(
                [
                  rule.name,
                  rule.toolName,
                  rule.operation ?? "",
                  rule.operationLabel,
                  rule.policy,
                  JSON.stringify(rule.conditions ?? {}),
                ].join(" "),
                query,
              ),
            );

        const emailRulesForResponse =
          effectiveKind === "approval" ? [] : filteredEmailRules;
        const approvalRulesForResponse =
          effectiveKind === "email" ? [] : filteredApprovalRules;

        const conciseSummary = {
          totalEmailRules: emailRulesForResponse.length,
          totalApprovalRules: approvalRulesForResponse.length,
          emailRuleTitles: emailRulesForResponse.slice(0, 5).map((rule) => rule.name),
          approvalRuleTitles: approvalRulesForResponse.slice(0, 5).map((rule) => rule.name),
          mode: "concise",
        };

        return {
          success: true,
          data: {
            about: account?.about || "Not set",
            summary: conciseSummary,
            // Legacy compatibility
            rules: emailRulesForResponse,
            emailRules: emailRulesForResponse,
            approvalRules: approvalRulesForResponse,
          },
        };
      }
      case "get_patterns": {
        const ruleName = payload?.ruleName as string | undefined;
        if (!ruleName) {
          return { success: false, error: "ruleName is required" };
        }
        const resolution = await resolveEmailRuleReference({
          emailAccountId: context.emailAccountId,
          reference: { name: ruleName },
        });
        if (resolution.status === "none") {
          return {
            success: false,
            error:
              "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
          };
        }
        if (resolution.status === "ambiguous") {
          return {
            success: false,
            error: "Multiple similar rules found. Please confirm which one you mean.",
            data: {
              needsConfirmation: true,
              candidates: resolution.matches.map((candidate) => ({
                name: candidate.name,
                id: candidate.id,
              })),
            },
          };
        }

        const rule = await prisma.rule.findUnique({
          where: { id: resolution.matches[0]!.id },
          select: {
            group: {
              select: {
                items: { select: { type: true, value: true, exclude: true } },
              },
            },
          },
        });
        if (!rule) {
          return { success: false, error: "Rule not found." };
        }

        return { success: true, data: { patterns: rule.group?.items } };
      }
      case "create": {
        const parsed = createRuleSchema(provider)
          .extend({
            runOnThreads: z.boolean().optional(),
          })
          .safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const args = parsed.data;
        const rule = await createRule({
          result: {
            name: args.name,
            ruleId: undefined,
            condition: args.condition,
            actions: mapRuleActionsForMutation({
              actions: args.actions,
              provider,
            }),
          },
          emailAccountId: context.emailAccountId,
          provider,
          runOnThreads: args.runOnThreads ?? true,
          logger: context.logger,
        });
        return { success: true, data: { ruleId: rule.id } };
      }
      case "update_conditions": {
        const parsed = updateRuleConditionSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const { ruleName, condition } = parsed.data;
        const resolution = await resolveEmailRuleReference({
          emailAccountId: context.emailAccountId,
          reference: { name: ruleName },
        });
        if (resolution.status === "none") {
          return {
            success: false,
            error:
              "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
          };
        }
        if (resolution.status === "ambiguous") {
          return {
            success: false,
            error: "Multiple similar rules found. Please confirm which one you mean.",
            data: {
              needsConfirmation: true,
              candidates: resolution.matches.map((candidate) => ({
                name: candidate.name,
                id: candidate.id,
              })),
            },
          };
        }

        const rule = await prisma.rule.findUnique({
          where: { id: resolution.matches[0]!.id },
          select: {
            id: true,
            instructions: true,
            from: true,
            to: true,
            subject: true,
            conditionalOperator: true,
            group: {
              select: {
                name: true,
              },
            },
          },
        });
        if (!rule) {
          return { success: false, error: "Rule not found." };
        }
        const originalConditions = {
          aiInstructions: rule.instructions,
          static: filterNullProperties({
            from: rule.from,
            to: rule.to,
            subject: rule.subject,
          }),
          conditionalOperator: rule.conditionalOperator,
          group: rule.group?.name,
        };
        const groupId = await resolveGroupId({
          emailAccountId: context.emailAccountId,
          groupName: condition.group,
        });
        await partialUpdateRule({
          ruleId: rule.id,
          data: {
            instructions: condition.aiInstructions,
            from: condition.static?.from,
            to: condition.static?.to,
            subject: condition.static?.subject,
            conditionalOperator: condition.conditionalOperator ?? undefined,
            ...(groupId !== undefined && { groupId }),
          },
        });
        const updatedConditions = {
          aiInstructions: condition.aiInstructions,
          static: condition.static
            ? filterNullProperties({
                from: condition.static.from,
                to: condition.static.to,
                subject: condition.static.subject,
              })
            : undefined,
          conditionalOperator: condition.conditionalOperator,
          group: condition.group,
        };
        return {
          success: true,
          data: { ruleId: rule.id, originalConditions, updatedConditions },
        };
      }
      case "update_actions": {
        const parsed = updateRuleActionSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const { ruleName, actions } = parsed.data;
        const resolution = await resolveEmailRuleReference({
          emailAccountId: context.emailAccountId,
          reference: { name: ruleName },
        });
        if (resolution.status === "none") {
          return {
            success: false,
            error:
              "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
          };
        }
        if (resolution.status === "ambiguous") {
          return {
            success: false,
            error: "Multiple similar rules found. Please confirm which one you mean.",
            data: {
              needsConfirmation: true,
              candidates: resolution.matches.map((candidate) => ({
                name: candidate.name,
                id: candidate.id,
              })),
            },
          };
        }

        const rule = await prisma.rule.findUnique({
          where: { id: resolution.matches[0]!.id },
          select: {
            id: true,
            actions: {
              select: {
                type: true,
                content: true,
                label: true,
                to: true,
                cc: true,
                bcc: true,
                subject: true,
                url: true,
                folderName: true,
                payload: true,
              },
            },
          },
        });
        if (!rule) {
          return { success: false, error: "Rule not found." };
        }
        const originalActions = rule.actions.map((actionItem) => ({
          type: actionItem.type,
          fields: filterNullProperties({
            label: actionItem.label,
            content: actionItem.content,
            to: actionItem.to,
            cc: actionItem.cc,
            bcc: actionItem.bcc,
            subject: actionItem.subject,
            webhookUrl: actionItem.url,
            payload: actionItem.payload,
            ...(isMicrosoftProvider(provider) && {
              folderName: actionItem.folderName,
            }),
          }),
        }));
        await updateRuleActions({
          ruleId: rule.id,
          actions: mapRuleActionsForMutation({
            actions,
            provider,
          }),
          provider,
          emailAccountId: context.emailAccountId,
          logger: context.logger,
        });
        return {
          success: true,
          data: { ruleId: rule.id, originalActions, updatedActions: actions },
        };
      }
      case "update_patterns": {
        const parsed = updateLearnedPatternsSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const { ruleName, learnedPatterns } = parsed.data;
        const resolution = await resolveEmailRuleReference({
          emailAccountId: context.emailAccountId,
          reference: { name: ruleName },
        });
        if (resolution.status === "none") {
          return { success: false, error: "Rule not found." };
        }
        if (resolution.status === "ambiguous") {
          return {
            success: false,
            error: "Multiple similar rules found. Please confirm which one you mean.",
            data: {
              needsConfirmation: true,
              candidates: resolution.matches.map((candidate) => ({
                name: candidate.name,
                id: candidate.id,
              })),
            },
          };
        }
        const resolvedRuleName = resolution.matches[0]!.name;
        const patterns = learnedPatterns.flatMap((pattern) => {
          const entries: Array<{
            type: GroupItemType;
            value: string;
            exclude?: boolean;
          }> = [];
          if (pattern.include?.from) {
            entries.push({
              type: GroupItemType.FROM,
              value: pattern.include.from,
              exclude: false,
            });
          }
          if (pattern.include?.subject) {
            entries.push({
              type: GroupItemType.SUBJECT,
              value: pattern.include.subject,
              exclude: false,
            });
          }
          if (pattern.exclude?.from) {
            entries.push({
              type: GroupItemType.FROM,
              value: pattern.exclude.from,
              exclude: true,
            });
          }
          if (pattern.exclude?.subject) {
            entries.push({
              type: GroupItemType.SUBJECT,
              value: pattern.exclude.subject,
              exclude: true,
            });
          }
          return entries;
        });
        const result = await saveLearnedPatterns({
          emailAccountId: context.emailAccountId,
          ruleName: resolvedRuleName,
          patterns,
          logger: context.logger,
        });
        if ("error" in result) {
          return { success: false, error: result.error };
        }
        return { success: true, data: { ruleName: resolvedRuleName } };
      }
      case "update_about": {
        const parsed = updateAboutSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        await updateAccountAbout({
          emailAccountId: context.emailAccountId,
          about: parsed.data.about,
        });
        return { success: true, data: { about: parsed.data.about } };
      }
      case "add_knowledge": {
        const parsed = addKnowledgeSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const knowledge = await prisma.knowledge.create({
          data: {
            userId: context.userId,
            emailAccountId: context.emailAccountId,
            title: parsed.data.title,
            content: parsed.data.content,
          },
        });
        return { success: true, data: knowledge };
      }
      case "list_approval_rules": {
        const parsedListPayload = listRulesPayloadSchema.safeParse(payload ?? {});
        if (!parsedListPayload.success) {
          return { success: false, error: "Invalid payload", data: parsedListPayload.error };
        }
        const includeIds = parsedListPayload.data.includeIds === true;
        const verbose = parsedListPayload.data.verbose === true;
        const query = parsedListPayload.data.query?.trim();
        const configs = await listApprovalRuleConfigs({ userId: context.userId });
        const approvalRules = configs.flatMap((config) =>
          config.rules.map((rule) => ({
            ...(includeIds ? { id: rule.id } : {}),
            name: rule.name,
            toolName: config.toolName,
            ...(verbose ? { operation: rule.operation } : {}),
            operationLabel: getApprovalOperationLabel(rule.operation ?? "unknown"),
            policy: rule.policy,
            enabled: rule.enabled ?? true,
            pausedUntil: rule.disabledUntil,
            conditions: rule.conditions,
            priority: rule.priority ?? 0,
          })),
        );
        const filtered = !query
          ? approvalRules
          : approvalRules.filter((rule) =>
              includesLoose(
                `${rule.name} ${rule.toolName} ${rule.operationLabel} ${rule.policy}`,
                query,
              ),
            );
        return {
          success: true,
          data: {
            approvalRules: filtered,
            summary: {
              totalApprovalRules: filtered.length,
              approvalRuleTitles: filtered.slice(0, 5).map((rule) => rule.name),
              mode: "concise",
            },
          },
        };
      }
      case "list_approval_operations": {
        const operations = listApprovalOperationKeys().map((operation) => ({
          operation,
          label: getApprovalOperationLabel(operation),
        }));
        return { success: true, data: { operations } };
      }
      case "set_approval_rule": {
        const parsed = setApprovalRuleSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const rule = await upsertApprovalRule({
          userId: context.userId,
          toolName: parsed.data.toolName,
          rule: {
            id: parsed.data.ruleId,
            name: parsed.data.name,
            policy: parsed.data.policy as ApprovalPolicy,
            resource: parsed.data.resource,
            operation: normalizeApprovalOperationKey(parsed.data.operation),
            enabled: parsed.data.enabled,
            priority: parsed.data.priority,
            conditions: parsed.data.conditions,
          },
        });
        return { success: true, data: rule };
      }
      case "remove_approval_rule": {
        const parsed = removeApprovalRuleSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const result = await removeApprovalRule({
          userId: context.userId,
          toolName: parsed.data.toolName,
          ruleId: parsed.data.ruleId,
        });
        if (!result.removed) {
          return { success: false, error: "Approval rule not found" };
        }
        return { success: true, data: result };
      }
      case "set_approval_default": {
        const parsed = setApprovalDefaultSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const result = await setApprovalToolDefaultPolicy({
          userId: context.userId,
          toolName: parsed.data.toolName,
          defaultPolicy: parsed.data.defaultPolicy as ApprovalPolicy,
          defaultConditions: parsed.data.defaultConditions,
        });
        return { success: true, data: result };
      }
      case "reset_approval_rules": {
        const parsed = resetApprovalRulesSchema.safeParse(payload ?? {});
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        await resetApprovalRuleConfig({
          userId: context.userId,
          toolName: parsed.data.toolName,
        });
        return {
          success: true,
          data: {
            reset: parsed.data.toolName ?? "all",
          },
        };
      }
      case "disable": {
        const parsed = lifecyclePayloadSchema.safeParse(payload ?? {});
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const until = parseDisableUntil(parsed.data);
        if (!until) {
          return { success: false, error: "Invalid disable window. Provide a future until or positive durationHours." };
        }
        const resolution = await resolveLifecycleRule({
          userId: context.userId,
          emailAccountId: context.emailAccountId,
          kind: parsed.data.kind,
          ruleId: parsed.data.ruleId,
          ruleName: parsed.data.ruleName,
          toolName: parsed.data.toolName,
        });
        if (resolution.status === "none") {
          return { success: false, error: "Rule not found." };
        }
        if (resolution.status === "ambiguous") {
          return {
            success: false,
            error: "Multiple similar rules found. Please confirm which one you mean.",
            data: {
              needsConfirmation: true,
              candidates: mapLifecycleConfirmationCandidates(resolution.candidates),
            },
          };
        }

        const selected = resolution.candidate;
        if (selected.kind === "approval") {
          const disabled = await disableApprovalRule({
            userId: context.userId,
            toolName: selected.toolName,
            ruleId: selected.id,
            disabledUntil: until,
          });
          if (!disabled.updated) return { success: false, error: "Approval rule not found." };
          return {
            success: true,
            data: {
              kind: "approval",
              name: disabled.rule?.name ?? selected.name,
              pausedUntil: until.toISOString(),
              toolName: selected.toolName,
            },
            message: `Disabled "${disabled.rule?.name ?? selected.name}" until ${until.toISOString()}.`,
          };
        }

        await temporarilyDisableEmailRule({
          emailAccountId: context.emailAccountId,
          ruleId: selected.id,
          until,
        });
        return {
          success: true,
          data: {
            kind: "email",
            ruleName: selected.name,
            pausedUntil: until.toISOString(),
          },
          message: `Disabled "${selected.name}" until ${until.toISOString()}.`,
        };
      }
      case "enable": {
        const parsed = lifecyclePayloadSchema.safeParse(payload ?? {});
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const resolution = await resolveLifecycleRule({
          userId: context.userId,
          emailAccountId: context.emailAccountId,
          kind: parsed.data.kind,
          ruleId: parsed.data.ruleId,
          ruleName: parsed.data.ruleName,
          toolName: parsed.data.toolName,
        });
        if (resolution.status === "none") return { success: false, error: "Rule not found." };
        if (resolution.status === "ambiguous") {
          return {
            success: false,
            error: "Multiple similar rules found. Please confirm which one you mean.",
            data: {
              needsConfirmation: true,
              candidates: mapLifecycleConfirmationCandidates(resolution.candidates),
            },
          };
        }
        const selected = resolution.candidate;
        if (selected.kind === "approval") {
          const enabled = await enableApprovalRule({
            userId: context.userId,
            toolName: selected.toolName,
            ruleId: selected.id,
          });
          if (!enabled.updated) return { success: false, error: "Approval rule not found." };
          return {
            success: true,
            data: { kind: "approval", name: enabled.rule?.name ?? selected.name, toolName: selected.toolName },
          };
        }
        await enableEmailRule({
          emailAccountId: context.emailAccountId,
          ruleId: selected.id,
        });
        return { success: true, data: { kind: "email", ruleName: selected.name } };
      }
      case "rename": {
        const parsed = lifecyclePayloadSchema.safeParse(payload ?? {});
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const newName = parsed.data.newName?.trim();
        if (!newName) return { success: false, error: "newName is required for rename." };
        const resolution = await resolveLifecycleRule({
          userId: context.userId,
          emailAccountId: context.emailAccountId,
          kind: parsed.data.kind,
          ruleId: parsed.data.ruleId,
          ruleName: parsed.data.ruleName,
          toolName: parsed.data.toolName,
        });
        if (resolution.status === "none") return { success: false, error: "Rule not found." };
        if (resolution.status === "ambiguous") {
          return {
            success: false,
            error: "Multiple similar rules found. Please confirm which one you mean.",
            data: {
              needsConfirmation: true,
              candidates: mapLifecycleConfirmationCandidates(resolution.candidates),
            },
          };
        }
        const selected = resolution.candidate;
        if (selected.kind === "approval") {
          const renamed = await renameApprovalRule({
            userId: context.userId,
            toolName: selected.toolName,
            ruleId: selected.id,
            name: newName,
          });
          if (!renamed.updated) return { success: false, error: "Approval rule not found." };
          return {
            success: true,
            data: { kind: "approval", name: renamed.rule?.name ?? newName, toolName: selected.toolName },
          };
        }

        const renamed = await renameEmailRule({
          emailAccountId: context.emailAccountId,
          ruleId: selected.id,
          name: newName,
        });
        return { success: true, data: { kind: "email", ruleName: renamed.name } };
      }
      case "delete": {
        const parsed = lifecyclePayloadSchema.safeParse(payload ?? {});
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        if (parsed.data.confirm !== true) {
          return {
            success: false,
            error: "Please confirm deletion by retrying with confirm=true.",
            data: { confirmationRequired: true },
          };
        }
        const resolution = await resolveLifecycleRule({
          userId: context.userId,
          emailAccountId: context.emailAccountId,
          kind: parsed.data.kind,
          ruleId: parsed.data.ruleId,
          ruleName: parsed.data.ruleName,
          toolName: parsed.data.toolName,
        });
        if (resolution.status === "none") return { success: false, error: "Rule not found." };
        if (resolution.status === "ambiguous") {
          return {
            success: false,
            error: "Multiple similar rules found. Please confirm which one you mean.",
            data: {
              needsConfirmation: true,
              candidates: mapLifecycleConfirmationCandidates(resolution.candidates),
            },
          };
        }
        const selected = resolution.candidate;
        if (selected.kind === "approval") {
          const removed = await removeApprovalRule({
            userId: context.userId,
            toolName: selected.toolName,
            ruleId: selected.id,
          });
          if (!removed.removed) return { success: false, error: "Approval rule not found." };
          return {
            success: true,
            data: {
              kind: "approval",
              deleted: true,
              ruleName: selected.name,
              toolName: selected.toolName,
            },
          };
        }

        await prisma.rule.delete({
          where: { id: selected.id },
        });
        return { success: true, data: { kind: "email", deleted: true, ruleName: selected.name } };
      }
      default:
        return { success: false, error: "Unsupported action" };
    }
  },
};

async function resolveGroupId({
  emailAccountId,
  groupName,
}: {
  emailAccountId: string;
  groupName?: string | null;
}): Promise<string | null | undefined> {
  if (groupName === null) return null;
  if (!groupName) return undefined;

  const group = await prisma.group.findFirst({
    where: {
      emailAccountId,
      name: groupName,
    },
  });

  if (!group) {
    throw new Error(`Group not found: ${groupName}`);
  }

  return group.id;
}
