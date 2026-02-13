import { createHash } from "crypto";
import type { SkillContract, CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { SlotResolutionResult } from "@/server/features/ai/skills/slots/resolve-slots";
import type { SkillCapabilities } from "@/server/features/ai/capabilities";
import type { ToolResult } from "@/server/features/ai/tools/types";
import { validateSkillPostconditions } from "@/server/features/ai/skills/executor/postconditions";
import { normalizeSkillFailure } from "@/server/features/ai/skills/executor/failure-normalizer";
import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { Logger } from "@/server/lib/logger";
import { compileSkillPlan } from "@/server/features/ai/skills/executor/compile-plan";
import { executeWithRepair } from "@/server/features/ai/skills/executor/repair";
import { evaluateApprovalRequirement } from "@/server/features/approvals/rules";
import { resolvePolicyConflict } from "@/server/features/ai/skills/policy/conflict-resolver";
import type { SkillPolicyContext } from "@/server/features/ai/skills/policy/context";
import { createCapabilityIdempotencyKey } from "@/server/features/ai/capabilities/idempotency";
import { ApprovalService, getApprovalExpiry } from "@/server/features/approvals/service";
import { createApprovalActionToken } from "@/server/features/approvals/action-token";
import prisma from "@/server/db/client";
import { env } from "@/env";
import type { CreateApprovalParams } from "@/server/features/approvals/types";

interface SkillApprovalRecord {
  id: string;
  requestPayload: Record<string, unknown>;
}

interface SkillResumeState {
  lastQueriedEmailIds?: string[];
  lastQueriedEmailItems?: unknown[];
  lastQueriedCalendarItems?: unknown[];
}

interface SkillResumeOptions {
  approvedStepId: string;
  bypassPolicyForStepId: string;
  executeOnlyApprovedStep?: boolean;
  initialState?: SkillResumeState;
}

export interface SkillExecutionResult {
  status: "success" | "partial" | "blocked" | "failed";
  responseText: string;
  postconditionsPassed: boolean;
  stepsExecuted: number;
  stepGraphSize: number;
  toolChain: CapabilityName[];
  stepDurationsMs: Record<string, number>;
  interactivePayloads: unknown[];
  actionEvents: Array<{
    stepId: string;
    capability: CapabilityName;
    success: boolean;
    itemCount: number;
    policyDecision: "allowed" | "blocked" | "not_applicable";
    errorCode?: string;
  }>;
  policyBlockCount: number;
  repairAttemptCount: number;
  diagnostics: {
    code: string;
    category: "missing_context" | "policy" | "transient" | "provider" | "unsupported" | "unknown";
  };
  failureReason?: string;
  approvals?: SkillApprovalRecord[];
}

export const EXECUTOR_SUPPORTED_CAPABILITIES: ReadonlySet<CapabilityName> = new Set<
  CapabilityName
>([
  "email.searchThreads",
  "email.searchThreadsAdvanced",
  "email.searchSent",
  "email.searchInbox",
  "email.getThreadMessages",
  "email.getMessagesBatch",
  "email.getLatestMessage",
  "email.batchArchive",
  "email.batchTrash",
  "email.markReadUnread",
  "email.applyLabels",
  "email.removeLabels",
  "email.moveThread",
  "email.markSpam",
  "email.unsubscribeSender",
  "email.blockSender",
  "email.bulkSenderArchive",
  "email.bulkSenderTrash",
  "email.bulkSenderLabel",
  "email.snoozeThread",
  "email.listFilters",
  "email.createFilter",
  "email.deleteFilter",
  "email.listDrafts",
  "email.getDraft",
  "email.createDraft",
  "email.updateDraft",
  "email.deleteDraft",
  "email.sendDraft",
  "email.sendNow",
  "email.reply",
  "email.forward",
  "email.scheduleSend",
  "calendar.findAvailability",
  "calendar.listEvents",
  "calendar.searchEventsByAttendee",
  "calendar.getEvent",
  "calendar.createEvent",
  "calendar.updateEvent",
  "calendar.deleteEvent",
  "calendar.manageAttendees",
  "calendar.updateRecurringMode",
  "calendar.rescheduleEvent",
  "calendar.setWorkingHours",
  "calendar.setWorkingLocation",
  "calendar.setOutOfOffice",
  "calendar.createFocusBlock",
  "calendar.createBookingSchedule",
  "planner.composeDayPlan",
  "planner.compileMultiActionPlan",
]);

const READ_ONLY_CAPABILITIES: ReadonlySet<CapabilityName> = new Set<CapabilityName>([
  "email.searchThreads",
  "email.searchThreadsAdvanced",
  "email.searchSent",
  "email.searchInbox",
  "email.getThreadMessages",
  "email.getMessagesBatch",
  "email.getLatestMessage",
  "email.listFilters",
  "email.listDrafts",
  "email.getDraft",
  "calendar.findAvailability",
  "calendar.listEvents",
  "calendar.searchEventsByAttendee",
  "calendar.getEvent",
  "planner.composeDayPlan",
  "planner.compileMultiActionPlan",
]);

function enforceAllowed(skill: SkillContract, capability: CapabilityName): void {
  if (!skill.allowed_tools.includes(capability)) {
    throw new Error(`allowed_tools_violation: ${capability} not allowed for ${skill.id}`);
  }
}

function renderTemplate(skill: SkillContract, status: SkillExecutionResult["status"]): string {
  const t = skill.user_response_templates;
  if (status === "success") return t.success;
  if (status === "partial") return t.partial;
  if (status === "blocked") return t.blocked;
  return t.failed;
}

function isFailure(result: ToolResult): boolean {
  return result.success !== true;
}

function deriveStepIdFromPolicyPrecheckNode(nodeId: string): string {
  const prefix = "policy_precheck_";
  return nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : nodeId;
}

function buildApprovalActionUrl(params: {
  approvalId: string;
  action: "approve" | "deny";
}): string {
  const token = createApprovalActionToken({
    approvalId: params.approvalId,
    action: params.action,
  });
  const path =
    params.action === "approve"
      ? `/approvals/${params.approvalId}`
      : `/approvals/${params.approvalId}/deny`;
  return `${env.NEXT_PUBLIC_BASE_URL}${path}?token=${token}`;
}

function buildSkillApprovalInteractivePayload(params: {
  approvalId: string;
  summary: string;
}): {
  type: "approval_request";
  approvalId: string;
  summary: string;
  actions: Array<{
    label: string;
    style: "primary" | "danger";
    value: string;
    url?: string;
  }>;
} {
  let approveUrl: string | undefined;
  let denyUrl: string | undefined;

  try {
    approveUrl = buildApprovalActionUrl({
      approvalId: params.approvalId,
      action: "approve",
    });
    denyUrl = buildApprovalActionUrl({
      approvalId: params.approvalId,
      action: "deny",
    });
  } catch {
    // Fall back to value-only actions when tokenized URL generation is unavailable.
  }

  return {
    type: "approval_request",
    approvalId: params.approvalId,
    summary: params.summary,
    actions: [
      { label: "Approve", style: "primary", value: "approve", ...(approveUrl ? { url: approveUrl } : {}) },
      { label: "Deny", style: "danger", value: "deny", ...(denyUrl ? { url: denyUrl } : {}) },
    ],
  };
}

function mapCapabilityToApprovalContext(params: {
  capability: CapabilityName;
  slots: Record<string, unknown>;
}): {
  toolName: string;
  args: Record<string, unknown>;
} {
  const { capability, slots } = params;
  const threadIds = Array.isArray(slots.thread_ids)
    ? (slots.thread_ids as string[])
    : typeof slots.thread_id === "string"
      ? [slots.thread_id]
      : [];
  const eventIds =
    typeof slots.event_id === "string" ? [slots.event_id] : [];
  const recipientEmails = [
    ...(Array.isArray(slots.recipient)
      ? (slots.recipient as unknown[]).filter(
          (value): value is string => typeof value === "string",
        )
      : []),
    ...getParticipantEmails(slots.participants),
    ...(typeof slots.attendee_email === "string" ? [slots.attendee_email] : []),
  ];

  const commonIds = threadIds.length > 0 ? threadIds : eventIds;
  const operationByCapability: Partial<Record<CapabilityName, string>> = {
    "email.batchTrash": "delete_email",
    "calendar.deleteEvent": "delete_calendar_event",
    "email.sendNow": "send_email",
    "email.sendDraft": "send_email",
    "email.reply": "send_email",
    "email.forward": "send_email",
    "calendar.createEvent": "create_calendar_event",
    "email.createDraft": "create_email_draft",
    "email.unsubscribeSender": "unsubscribe_sender",
    "email.bulkSenderTrash": "bulk_trash_senders",
    "email.bulkSenderArchive": "bulk_archive_senders",
    "email.bulkSenderLabel": "bulk_label_senders",
    "email.batchArchive": "archive_email",
    "calendar.rescheduleEvent": "update_calendar_event",
  };
  const operation = operationByCapability[capability];

  if (
    capability.startsWith("email.delete") ||
    capability === "email.batchTrash" ||
    capability === "calendar.deleteEvent"
  ) {
    return {
      toolName: "delete",
      args: {
        resource: capability.startsWith("calendar") ? "calendar" : "email",
        ids: commonIds,
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (
    capability === "email.sendNow" ||
    capability === "email.sendDraft" ||
    capability === "email.reply" ||
    capability === "email.forward"
  ) {
    return {
      toolName: "send",
      args: {
        resource: "email",
        to: recipientEmails,
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (
    capability.startsWith("calendar.create") ||
    capability.startsWith("email.create")
  ) {
    return {
      toolName: "create",
      args: {
        resource: capability.startsWith("calendar") ? "calendar" : "email",
        ...(recipientEmails.length > 0 ? { to: recipientEmails } : {}),
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (capability === "email.unsubscribeSender") {
    return {
      toolName: "modify",
      args: {
        resource: "email",
        ids: threadIds,
        changes: { unsubscribe: true },
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (capability === "email.bulkSenderTrash") {
    return {
      toolName: "modify",
      args: {
        resource: "email",
        ids: threadIds,
        changes: { bulk_trash_senders: true },
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (capability === "email.bulkSenderArchive") {
    return {
      toolName: "modify",
      args: {
        resource: "email",
        ids: threadIds,
        changes: { bulk_archive_senders: true },
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (capability === "email.bulkSenderLabel") {
    return {
      toolName: "modify",
      args: {
        resource: "email",
        ids: threadIds,
        changes: { bulk_label_senders: true },
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (capability === "email.batchArchive") {
    return {
      toolName: "modify",
      args: {
        resource: "email",
        ids: threadIds,
        changes: { archive: true },
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (capability === "email.markSpam") {
    return {
      toolName: "modify",
      args: {
        resource: "email",
        ids: threadIds,
        changes: { trash: true },
        ...(operation ? { operation } : {}),
      },
    };
  }
  if (capability.startsWith("calendar.")) {
    return {
      toolName: "modify",
      args: {
        resource: "calendar",
        ids: eventIds,
        to: recipientEmails,
        ...(operation ? { operation } : {}),
      },
    };
  }
  return {
    toolName: "modify",
    args: {
      resource: capability.startsWith("calendar") ? "calendar" : "email",
      ids: commonIds,
      ...(recipientEmails.length > 0 ? { to: recipientEmails } : {}),
      ...(operation ? { operation } : {}),
    },
  };
}

function toolClarificationPrompt(result: ToolResult): string | null {
  return result.clarification?.prompt ?? null;
}

function getDateRangeFromSlot(value: unknown): { after?: string; before?: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const start = typeof v.start === "string" ? v.start : undefined;
  const end = typeof v.end === "string" ? v.end : undefined;
  if (!start && !end) return null;
  return { after: start, ...(end ? { before: end } : {}) };
}

function dayRange(offsetDays: number): { after: string; before: string } {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + offsetDays);
  const end = new Date(base);
  end.setDate(end.getDate() + 1);
  return { after: base.toISOString(), before: end.toISOString() };
}

function weekRange(): { after: string; before: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { after: start.toISOString(), before: end.toISOString() };
}

function getAvailabilityWindowFromSlot(value: unknown): { start?: string; end?: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const start = typeof v.start === "string" ? v.start : undefined;
  const end = typeof v.end === "string" ? v.end : undefined;
  if (!start && !end) return null;
  return { start, end };
}

function isOutsideWorkingHours(params: {
  startIso?: string;
  endIso?: string;
  preference?: SkillPolicyContext["workingHours"] | null;
}): boolean {
  if (!params.preference || !params.startIso || !params.endIso) return false;
  const start = new Date(params.startIso);
  const end = new Date(params.endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const day = start.getUTCDay();
  if (!params.preference.workDays.includes(day)) return true;
  const startHour = start.getUTCHours();
  const endHour = end.getUTCHours();
  return (
    startHour < params.preference.workHourStart ||
    endHour > params.preference.workHourEnd
  );
}

function extractQueryMessageIds(result: ToolResult | undefined): string[] {
  const data = result?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).id : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function getCalendarSlots(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const slots = (data as Record<string, unknown>).slots;
  return Array.isArray(slots) ? slots : [];
}

function getParticipantEmails(participants: unknown): string[] {
  if (!participants || typeof participants !== "object") return [];
  const emails = (participants as Record<string, unknown>).emails;
  return Array.isArray(emails)
    ? emails.filter((value): value is string => typeof value === "string")
    : [];
}

const summarizeThreadSchema = z.object({
  decisions: z.array(z.string()).default([]),
  actionItems: z.array(z.string()).default([]),
  deadlines: z.array(z.string()).default([]),
}).strict();

async function summarizeThreadWithLLM(params: {
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
  messages: Array<{ subject?: string | null; snippet?: string | null; textPlain?: string | null; headers?: Record<string, unknown> | null }>;
}): Promise<z.infer<typeof summarizeThreadSchema>> {
  const modelOptions = getModel();
  const generateObject = createGenerateObject({
    emailAccount: params.emailAccount,
    label: "Skills thread summary",
    modelOptions,
  });

  const compact = params.messages.slice(-12).map((m) => ({
    subject: m.subject ?? null,
    snippet: m.snippet ?? (m.textPlain ? String(m.textPlain).slice(0, 200) : null),
    from:
      m.headers && typeof m.headers === "object"
        ? (m.headers as Record<string, unknown>).from ?? null
        : null,
    to:
      m.headers && typeof m.headers === "object"
        ? (m.headers as Record<string, unknown>).to ?? null
        : null,
  }));

  const { object } = await generateObject({
    ...modelOptions,
    schema: summarizeThreadSchema,
    prompt: `Summarize the email thread into:
- decisions (finalized choices)
- actionItems (who should do what)
- deadlines (explicit dates/times or time constraints)

Rules:
- Be concise.
- Do not invent facts.
- If unknown, leave arrays empty.

Thread messages (most recent last):
${JSON.stringify(compact)}
`,
  });

  return object;
}

export async function executeSkill(params: {
  skill: SkillContract;
  slots: SlotResolutionResult;
  capabilities: SkillCapabilities;
  runtime: {
    logger: Logger;
    emailAccount: { id: string; email: string; userId: string };
    policyContext?: SkillPolicyContext;
    approvalContext?: {
      provider?: string;
      conversationId?: string;
      channelId?: string;
      threadId?: string;
      messageId?: string;
      teamId?: string;
      sourceEmailMessageId?: string;
      sourceEmailThreadId?: string;
      sourceCalendarEventId?: string;
    };
  };
  resume?: SkillResumeOptions;
}): Promise<SkillExecutionResult> {
  const { skill, slots, capabilities, runtime } = params;

  if (slots.missingRequired.length > 0) {
    return {
      status: "blocked",
      responseText: slots.clarificationPrompt ?? renderTemplate(skill, "blocked"),
      postconditionsPassed: false,
      stepsExecuted: 0,
      stepGraphSize: 0,
      toolChain: [],
      stepDurationsMs: {},
      interactivePayloads: [],
      actionEvents: [],
      policyBlockCount: 0,
      repairAttemptCount: 0,
      diagnostics: { code: "missing_required_slots", category: "missing_context" },
      failureReason: "missing_required_slots",
    };
  }

  const toolChain: CapabilityName[] = [];
  const stepDurationsMs: Record<string, number> = {};
  let stepsExecuted = 0;
  const toolResults: Record<string, ToolResult> = {};
  const interactivePayloads: unknown[] = [];
  const approvals: SkillApprovalRecord[] = [];
  let lastQueriedEmailIds: string[] = params.resume?.initialState?.lastQueriedEmailIds ?? [];
  let lastQueriedEmailItems: unknown[] = params.resume?.initialState?.lastQueriedEmailItems ?? [];
  let lastQueriedCalendarItems: unknown[] = params.resume?.initialState?.lastQueriedCalendarItems ?? [];
  let lastCapabilityStepId = "";
  const mutationResultCache = new Map<string, ToolResult>();
  const actionEvents: SkillExecutionResult["actionEvents"] = [];
  let policyBlockCount = 0;
  let repairAttemptCount = 0;
  const compiledPlan = compileSkillPlan({ skill, slotResolution: slots });
  const mutatingPolicyByCapability: Partial<Record<CapabilityName, Awaited<ReturnType<typeof evaluateApprovalRequirement>>>> =
    {};
  const resumeStepId = params.resume?.approvedStepId;
  let resumeActive = !resumeStepId;
  let resumeStepFound = !resumeStepId;

  const runWithTiming = async (
    stepId: string,
    execute: () => Promise<ToolResult>,
  ): Promise<ToolResult> => {
    const currentCapability = toolChain[toolChain.length - 1];
    const isMutating = Boolean(
      currentCapability && !READ_ONLY_CAPABILITIES.has(currentCapability),
    );
    const mutationKey =
      isMutating && currentCapability
        ? createCapabilityIdempotencyKey({
            scope: skill.idempotency_scope,
            userId: runtime.emailAccount.userId,
            emailAccountId: runtime.emailAccount.id,
            capability: currentCapability,
            seed: stepId,
            payload: slots.resolved as Record<string, unknown>,
          })
        : null;

    if (mutationKey && mutationResultCache.has(mutationKey)) {
      return mutationResultCache.get(mutationKey)!;
    }

    const startedAt = Date.now();
    const { result, attempts } = await executeWithRepair(
      execute,
      isMutating
        ? { maxAttempts: 1, baseDelayMs: 150 }
        : { maxAttempts: 3, baseDelayMs: 300 },
    );
    stepDurationsMs[stepId] = Date.now() - startedAt;
    repairAttemptCount += Math.max(0, attempts - 1);
    if (mutationKey) {
      mutationResultCache.set(mutationKey, result);
    }
    return result;
  };

  try {
    for (const node of compiledPlan.nodes) {
      if (!resumeActive) {
        if (node.type === "policy_precheck" && node.id === `policy_precheck_${resumeStepId}`) {
          continue;
        }
        if (node.type === "capability_call" && node.id === resumeStepId) {
          resumeActive = true;
          resumeStepFound = true;
        } else {
          continue;
        }
      }

      if (node.type === "conditional_skip") continue;
      if (node.type === "transform") continue;
      if (node.type === "conditional") continue;
      if (node.type === "policy_precheck") {
        const precheckStepId = deriveStepIdFromPolicyPrecheckNode(node.id);
        if (
          params.resume?.bypassPolicyForStepId &&
          precheckStepId === params.resume.bypassPolicyForStepId
        ) {
          continue;
        }

        const policyContext = mapCapabilityToApprovalContext({
          capability: node.capability,
          slots: slots.resolved as Record<string, unknown>,
        });
        const approval = await evaluateApprovalRequirement({
          userId: runtime.emailAccount.userId,
          toolName: policyContext.toolName,
          args: policyContext.args,
        });
        mutatingPolicyByCapability[node.capability] = approval;
        if (approval.requiresApproval) {
          const conflict = resolvePolicyConflict({
            capability: node.capability,
            approval,
          });
          const blockedStepId = deriveStepIdFromPolicyPrecheckNode(node.id);
          const approvalPayload: CreateApprovalParams["requestPayload"] = {
            actionType: "skill_execution_resume",
            description: conflict.userMessage,
            skillId: skill.id,
            stepId: blockedStepId,
            capability: node.capability,
            tool: policyContext.toolName,
            args: policyContext.args,
            emailAccountId: runtime.emailAccount.id,
            conversationId: runtime.approvalContext?.conversationId,
            threadId: runtime.approvalContext?.threadId,
            messageId: runtime.approvalContext?.messageId,
            sourceEmailMessageId: runtime.approvalContext?.sourceEmailMessageId,
            sourceEmailThreadId: runtime.approvalContext?.sourceEmailThreadId,
            sourceCalendarEventId: runtime.approvalContext?.sourceCalendarEventId,
            resume: {
              resolvedSlots: slots.resolved as Record<string, unknown>,
              executionState: {
                lastQueriedEmailIds,
              },
            },
          };
          const idempotencyFingerprint = createHash("sha256")
            .update(
              JSON.stringify({
                userId: runtime.emailAccount.userId,
                skillId: skill.id,
                stepId: blockedStepId,
                capability: node.capability,
                resume: approvalPayload.resume,
              }),
            )
            .digest("hex");
          const approvalService = new ApprovalService(prisma);
          const expiresInSeconds = await getApprovalExpiry(runtime.emailAccount.userId);
          const approvalRequest = await approvalService.createRequest({
            userId: runtime.emailAccount.userId,
            provider: runtime.approvalContext?.provider ?? "web",
            externalContext: {
              conversationId: runtime.approvalContext?.conversationId,
              channelId: runtime.approvalContext?.channelId,
              threadId: runtime.approvalContext?.threadId,
              messageId: runtime.approvalContext?.messageId,
              workspaceId: runtime.approvalContext?.teamId,
            },
            requestPayload: approvalPayload,
            idempotencyKey: `skill-approval:${runtime.emailAccount.userId}:${idempotencyFingerprint}`,
            expiresInSeconds,
          });
          approvals.push({
            id: approvalRequest.id,
            requestPayload: approvalPayload,
          });
          interactivePayloads.push(
            buildSkillApprovalInteractivePayload({
              approvalId: approvalRequest.id,
              summary: conflict.suggestedAlternative
                ? `${conflict.userMessage} ${conflict.suggestedAlternative}`
                : conflict.userMessage,
            }),
          );
          actionEvents.push({
            stepId: blockedStepId,
            capability: node.capability,
            success: false,
            itemCount: 0,
            policyDecision: "blocked",
            errorCode: "approval_required",
          });
          policyBlockCount += 1;
          return {
            status: "blocked",
            responseText: conflict.suggestedAlternative
              ? `${conflict.userMessage} ${conflict.suggestedAlternative}`
              : conflict.userMessage,
            postconditionsPassed: false,
            stepsExecuted,
            stepGraphSize: compiledPlan.nodes.length,
            toolChain,
            stepDurationsMs,
            interactivePayloads,
            actionEvents,
            policyBlockCount,
            repairAttemptCount,
            diagnostics: { code: conflict.reasonCode, category: "policy" },
            failureReason: "approval_required",
            approvals,
          };
        }
        continue;
      }
      if (node.type === "postcondition_check") continue;
      const step = node;
      stepsExecuted += 1;
      if (!step.capability) continue;
      enforceAllowed(skill, step.capability);
      toolChain.push(step.capability);
      lastCapabilityStepId = step.id;

      // Deterministic baseline executor: map slot values into narrow capability calls.
      switch (step.capability) {
        case "email.searchThreads": {
          const window = getDateRangeFromSlot(
            slots.resolved.time_window ?? slots.resolved.date_window ?? slots.resolved.analysis_window,
          );
          const scope = typeof slots.resolved.target_scope === "string" ? slots.resolved.target_scope : null;
          const scopeWindow =
            scope === "today"
              ? dayRange(0)
              : scope === "this_week"
                ? weekRange()
                : null;
          const filter: Record<string, unknown> = {
            limit: 25,
            ...(window ? { dateRange: window } : {}),
            ...(!window && scopeWindow ? { dateRange: scopeWindow } : {}),
            ...(typeof slots.resolved.sender_or_domain === "string" ? { from: slots.resolved.sender_or_domain } : {}),
          };
          if (skill.id === "inbox_bulk_newsletter_cleanup" || skill.id === "inbox_subscription_control") {
            filter.subscriptionsOnly = true;
            filter.limit = 100;
            filter.fetchAll = true;
          }
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.searchThreads(filter),
          );
          lastQueriedEmailIds = extractQueryMessageIds(toolResults[step.id]);
          lastQueriedEmailItems = Array.isArray(toolResults[step.id]?.data) ? (toolResults[step.id]!.data as unknown[]) : [];
          break;
        }
        case "email.searchThreadsAdvanced": {
          const filter: Record<string, unknown> = {
            limit: 50,
            ...(typeof slots.resolved.sender_or_domain === "string"
              ? { from: slots.resolved.sender_or_domain }
              : {}),
            ...(typeof slots.resolved.query === "string"
              ? { query: slots.resolved.query }
              : {}),
          };
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.searchThreadsAdvanced(filter),
          );
          lastQueriedEmailIds = extractQueryMessageIds(toolResults[step.id]);
          lastQueriedEmailItems = Array.isArray(toolResults[step.id]?.data)
            ? (toolResults[step.id]!.data as unknown[])
            : [];
          break;
        }
        case "email.searchSent": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.searchSent({ limit: 25 }),
          );
          lastQueriedEmailIds = extractQueryMessageIds(toolResults[step.id]);
          lastQueriedEmailItems = Array.isArray(toolResults[step.id]?.data)
            ? (toolResults[step.id]!.data as unknown[])
            : [];
          break;
        }
        case "email.searchInbox": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.searchInbox({ limit: 25 }),
          );
          lastQueriedEmailIds = extractQueryMessageIds(toolResults[step.id]);
          lastQueriedEmailItems = Array.isArray(toolResults[step.id]?.data)
            ? (toolResults[step.id]!.data as unknown[])
            : [];
          break;
        }
        case "email.getThreadMessages": {
          const threadId = String(slots.resolved.thread_id ?? "");
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.getThreadMessages(threadId),
          );
          break;
        }
        case "email.getMessagesBatch": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.getMessagesBatch(ids),
          );
          break;
        }
        case "email.getLatestMessage": {
          const threadId =
            typeof slots.resolved.thread_id === "string"
              ? slots.resolved.thread_id
              : typeof slots.resolved.message_id === "string"
                ? slots.resolved.message_id
                : "";
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.getLatestMessage(threadId),
          );
          break;
        }
        case "email.batchArchive": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.batchArchive(ids),
          );
          break;
        }
        case "email.batchTrash": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.batchTrash(ids),
          );
          break;
        }
        case "email.markReadUnread": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          const read = Boolean(slots.resolved.read ?? true);
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.markReadUnread(ids, read),
          );
          break;
        }
        case "email.applyLabels": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          const labelIds = Array.isArray(slots.resolved.label_ids)
            ? (slots.resolved.label_ids as string[])
            : [];
          if (
            skill.id === "inbox_label_management" &&
            String(slots.resolved.label_action ?? "").toLowerCase() === "remove"
          ) {
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.removeLabels(ids, labelIds),
            );
          } else {
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.applyLabels(ids, labelIds),
            );
          }
          break;
        }
        case "email.removeLabels": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          const labelIds = Array.isArray(slots.resolved.label_ids)
            ? (slots.resolved.label_ids as string[])
            : [];
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.removeLabels(ids, labelIds),
          );
          break;
        }
        case "email.moveThread": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          const folderName = String(slots.resolved.folder_name ?? "");
          if (
            skill.id === "inbox_move_or_spam_control" &&
            String(slots.resolved.action_type ?? "").toLowerCase() === "spam"
          ) {
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.markSpam(ids),
            );
          } else {
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.moveThread(ids, folderName),
            );
          }
          break;
        }
        case "email.markSpam": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.markSpam(ids),
          );
          break;
        }
        case "email.unsubscribeSender": {
          const sender = slots.resolved.sender_or_domain;
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.unsubscribeSender({
              filter: sender ? { from: String(sender), subscriptionsOnly: true, limit: 25 } : undefined,
            }),
          );
          break;
        }
        case "email.blockSender": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.blockSender(ids),
          );
          break;
        }
        case "email.bulkSenderArchive": {
          const sender = slots.resolved.sender_or_domain;
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.bulkSenderArchive({
              ...(sender ? { from: String(sender) } : {}),
              subscriptionsOnly: true,
            }),
          );
          break;
        }
        case "email.bulkSenderTrash": {
          const sender = slots.resolved.sender_or_domain;
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.bulkSenderTrash({
              ...(sender ? { from: String(sender) } : {}),
              subscriptionsOnly: true,
            }),
          );
          break;
        }
        case "email.bulkSenderLabel": {
          const sender = slots.resolved.sender_or_domain;
          const labelId =
            typeof slots.resolved.label_id === "string"
              ? slots.resolved.label_id
              : "";
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.bulkSenderLabel({
              filter: {
                ...(sender ? { from: String(sender) } : {}),
              },
              labelId,
            }),
          );
          break;
        }
        case "email.snoozeThread": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          const until = typeof slots.resolved.defer_until === "string" ? slots.resolved.defer_until : "";
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.snoozeThread(ids, until),
          );
          break;
        }
        case "email.listFilters": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.listFilters(),
          );
          break;
        }
        case "email.createFilter": {
          const filterAction = String(slots.resolved.filter_action ?? "").toLowerCase();
          if (skill.id === "inbox_filter_management" && filterAction === "delete") {
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.deleteFilter(String(slots.resolved.filter_id ?? "")),
            );
          } else if (skill.id === "inbox_filter_management" && filterAction === "list") {
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.listFilters(),
            );
          } else {
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.createFilter({
                from: String(slots.resolved.sender_or_domain ?? ""),
                autoArchiveLabelName:
                  typeof slots.resolved.label_name === "string"
                    ? slots.resolved.label_name
                    : undefined,
              }),
            );
          }
          break;
        }
        case "email.deleteFilter": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.deleteFilter(String(slots.resolved.filter_id ?? "")),
          );
          break;
        }
        case "email.listDrafts": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.listDrafts(
              typeof slots.resolved.limit === "number" ? slots.resolved.limit : 25,
            ),
          );
          break;
        }
        case "email.getDraft": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.getDraft(String(slots.resolved.draft_id ?? "")),
          );
          break;
        }
        case "email.createDraft": {
          const threadId = typeof slots.resolved.thread_id === "string" ? slots.resolved.thread_id : undefined;
          const recipient = Array.isArray(slots.resolved.recipient)
            ? (slots.resolved.recipient as string[])
            : [];
          const body = typeof slots.resolved.body === "string" ? slots.resolved.body : "Draft reply.";
          const subject = typeof slots.resolved.subject === "string" ? slots.resolved.subject : undefined;
          if (!threadId && recipient.length === 0) {
            return {
              status: "blocked",
              responseText: "Who should this draft be sent to? If this is a reply, share the thread context.",
              postconditionsPassed: false,
              stepsExecuted,
              stepGraphSize: compiledPlan.nodes.length,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              actionEvents,
              policyBlockCount,
              repairAttemptCount,
              diagnostics: { code: "missing_recipient_or_thread", category: "missing_context" },
              failureReason: "missing_recipient_or_thread",
            };
          }
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.createDraft({
              ...(threadId ? { type: "reply", parentId: threadId } : {}),
              ...(recipient.length > 0 ? { to: recipient } : {}),
              ...(subject ? { subject } : {}),
              body,
            }),
          );
          break;
        }
        case "email.updateDraft": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.updateDraft({
              draftId: String(slots.resolved.draft_id ?? ""),
              ...(typeof slots.resolved.subject === "string"
                ? { subject: slots.resolved.subject }
                : {}),
              ...(typeof slots.resolved.body === "string"
                ? { body: slots.resolved.body }
                : {}),
            }),
          );
          break;
        }
        case "email.deleteDraft": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.deleteDraft(String(slots.resolved.draft_id ?? "")),
          );
          break;
        }
        case "email.sendDraft": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.sendDraft(String(slots.resolved.draft_id ?? "")),
          );
          break;
        }
        case "email.sendNow": {
          const recipient = Array.isArray(slots.resolved.recipient)
            ? (slots.resolved.recipient as string[])
            : [];
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.sendNow({
              ...(typeof slots.resolved.draft_id === "string"
                ? { draftId: slots.resolved.draft_id }
                : {}),
              ...(recipient.length > 0 ? { to: recipient } : {}),
              ...(typeof slots.resolved.subject === "string"
                ? { subject: slots.resolved.subject }
                : {}),
              ...(typeof slots.resolved.body === "string"
                ? { body: slots.resolved.body }
                : {}),
            }),
          );
          break;
        }
        case "email.reply": {
          const sendMode = String(slots.resolved.send_mode ?? "").toLowerCase();
          const parentId = String(
            slots.resolved.thread_id ?? slots.resolved.message_id ?? "",
          );
          const body =
            typeof slots.resolved.body === "string"
              ? slots.resolved.body
              : "Thanks - sent from Amodel.";
          if (skill.id === "inbox_reply_or_forward_send" && sendMode === "forward") {
            const recipient = Array.isArray(slots.resolved.recipient)
              ? (slots.resolved.recipient as string[])
              : [];
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.forward({
                parentId,
                to: recipient,
                body,
                ...(typeof slots.resolved.subject === "string"
                  ? { subject: slots.resolved.subject }
                  : {}),
              }),
            );
          } else if (
            skill.id === "inbox_reply_or_forward_send" &&
            sendMode === "send_now"
          ) {
            const recipient = Array.isArray(slots.resolved.recipient)
              ? (slots.resolved.recipient as string[])
              : [];
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.sendNow({
                ...(recipient.length > 0 ? { to: recipient } : {}),
                ...(typeof slots.resolved.subject === "string"
                  ? { subject: slots.resolved.subject }
                  : {}),
                body,
              }),
            );
          } else {
            toolResults[step.id] = await runWithTiming(step.id, () =>
              capabilities.email.reply({
                parentId,
                body,
                ...(typeof slots.resolved.subject === "string"
                  ? { subject: slots.resolved.subject }
                  : {}),
              }),
            );
          }
          break;
        }
        case "email.forward": {
          const recipient = Array.isArray(slots.resolved.recipient)
            ? (slots.resolved.recipient as string[])
            : [];
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.forward({
              parentId: String(slots.resolved.thread_id ?? slots.resolved.message_id ?? ""),
              to: recipient,
              ...(typeof slots.resolved.body === "string"
                ? { body: slots.resolved.body }
                : {}),
              ...(typeof slots.resolved.subject === "string"
                ? { subject: slots.resolved.subject }
                : {}),
            }),
          );
          break;
        }
        case "email.scheduleSend": {
          const draftId = String(slots.resolved.draft_id ?? "");
          const sendTime = typeof slots.resolved.send_time === "string" ? slots.resolved.send_time : "";
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.email.scheduleSend(draftId, sendTime),
          );
          break;
        }
        case "calendar.findAvailability": {
          const durationMinutes = typeof slots.resolved.duration === "number" ? slots.resolved.duration : 30;
          const window = getAvailabilityWindowFromSlot(
            slots.resolved.date_window ??
              slots.resolved.reschedule_window ??
              slots.resolved.analysis_window ??
              slots.resolved.focus_block_window,
          );
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.findAvailability({
              durationMinutes,
              ...(window?.start ? { start: window.start } : {}),
              ...(window?.end ? { end: window.end } : {}),
            }),
          );
          lastQueriedCalendarItems = getCalendarSlots(toolResults[step.id]?.data);
          break;
        }
        case "calendar.listEvents": {
          const range = getDateRangeFromSlot(
            slots.resolved.date_window ?? slots.resolved.analysis_window ?? slots.resolved.time_window,
          );
          const filter: Record<string, unknown> = {
            limit: 50,
            ...(range ? { dateRange: range } : {}),
          };
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.listEvents(filter),
          );
          lastQueriedCalendarItems = Array.isArray(toolResults[step.id]?.data) ? (toolResults[step.id]!.data as unknown[]) : [];
          break;
        }
        case "calendar.searchEventsByAttendee": {
          const range = getDateRangeFromSlot(
            slots.resolved.date_window ?? slots.resolved.analysis_window ?? slots.resolved.time_window,
          );
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.searchEventsByAttendee({
              ...(range ? { dateRange: range } : {}),
              ...(typeof slots.resolved.attendee_email === "string"
                ? { attendeeEmail: slots.resolved.attendee_email }
                : {}),
            }),
          );
          lastQueriedCalendarItems = Array.isArray(toolResults[step.id]?.data)
            ? (toolResults[step.id]!.data as unknown[])
            : [];
          break;
        }
        case "calendar.getEvent": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.getEvent({
              eventId: String(slots.resolved.event_id ?? ""),
              ...(typeof slots.resolved.calendar_id === "string"
                ? { calendarId: slots.resolved.calendar_id }
                : {}),
            }),
          );
          break;
        }
        case "calendar.createEvent": {
          const title = typeof slots.resolved.title === "string" ? slots.resolved.title : "New event";
          const start = typeof slots.resolved.start === "string" ? slots.resolved.start : undefined;
          const durationMinutes = typeof slots.resolved.duration === "number" ? slots.resolved.duration : undefined;
          const end =
            typeof slots.resolved.end === "string"
              ? slots.resolved.end
              : start && durationMinutes
                ? new Date(new Date(start).getTime() + durationMinutes * 60 * 1000).toISOString()
                : undefined;
          const participantsFromSlots = getParticipantEmails(slots.resolved.participants);
          const participants = participantsFromSlots.length > 0
            ? participantsFromSlots
            : Array.isArray(slots.resolved.recipient)
              ? (slots.resolved.recipient as string[])
              : [];
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.createEvent({
              title,
              ...(start ? { start } : {}),
              ...(end ? { end } : {}),
              ...(participants.length > 0 ? { attendees: participants } : {}),
              ...(typeof slots.resolved.location === "string" ? { location: slots.resolved.location } : {}),
              ...(typeof slots.resolved.agenda === "string" ? { description: slots.resolved.agenda } : {}),
            }),
          );
          break;
        }
        case "calendar.updateEvent": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.updateEvent({
              eventId: String(slots.resolved.event_id ?? ""),
              ...(typeof slots.resolved.calendar_id === "string"
                ? { calendarId: slots.resolved.calendar_id }
                : {}),
              changes: {
                ...(typeof slots.resolved.title === "string"
                  ? { title: slots.resolved.title }
                  : {}),
                ...(typeof slots.resolved.start === "string"
                  ? { start: slots.resolved.start }
                  : {}),
                ...(typeof slots.resolved.end === "string"
                  ? { end: slots.resolved.end }
                  : {}),
                ...(typeof slots.resolved.agenda === "string"
                  ? { description: slots.resolved.agenda }
                  : {}),
              },
            }),
          );
          break;
        }
        case "calendar.deleteEvent": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.deleteEvent({
              eventId: String(slots.resolved.event_id ?? ""),
              ...(typeof slots.resolved.calendar_id === "string"
                ? { calendarId: slots.resolved.calendar_id }
                : {}),
              ...(typeof slots.resolved.mode === "string" &&
              (slots.resolved.mode === "single" || slots.resolved.mode === "series")
                ? { mode: slots.resolved.mode }
                : {}),
            }),
          );
          break;
        }
        case "calendar.manageAttendees": {
          const attendeesFromSlots = getParticipantEmails(slots.resolved.participants);
          const attendees = attendeesFromSlots.length > 0
            ? attendeesFromSlots
            : Array.isArray(slots.resolved.recipient)
              ? (slots.resolved.recipient as string[])
              : [];
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.manageAttendees({
              eventId: String(slots.resolved.event_id ?? ""),
              attendees,
              ...(typeof slots.resolved.calendar_id === "string"
                ? { calendarId: slots.resolved.calendar_id }
                : {}),
              ...(typeof slots.resolved.mode === "string" &&
              (slots.resolved.mode === "single" || slots.resolved.mode === "series")
                ? { mode: slots.resolved.mode }
                : {}),
            }),
          );
          break;
        }
        case "calendar.updateRecurringMode": {
          const mode =
            typeof slots.resolved.mode === "string" &&
            (slots.resolved.mode === "single" || slots.resolved.mode === "series")
              ? slots.resolved.mode
              : "single";
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.updateRecurringMode({
              eventId: String(slots.resolved.event_id ?? ""),
              mode,
              ...(typeof slots.resolved.calendar_id === "string"
                ? { calendarId: slots.resolved.calendar_id }
                : {}),
              changes: {
                ...(typeof slots.resolved.start === "string"
                  ? { start: slots.resolved.start }
                  : {}),
                ...(typeof slots.resolved.end === "string"
                  ? { end: slots.resolved.end }
                  : {}),
              },
            }),
          );
          break;
        }
        case "calendar.rescheduleEvent": {
          const eventId = String(slots.resolved.event_id ?? "");
          const window = getAvailabilityWindowFromSlot(slots.resolved.reschedule_window);
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.rescheduleEvent([eventId], {
              reschedule: "next_available",
              ...(window?.start ? { after: window.start } : {}),
              ...(window?.end ? { before: window.end } : {}),
            }),
          );
          break;
        }
        case "calendar.setWorkingHours": {
          const changes: Record<string, unknown> = {};
          if (typeof slots.resolved.timezone === "string") changes.timeZone = slots.resolved.timezone;
          if (typeof slots.resolved.workHourStart === "number") changes.workHourStart = slots.resolved.workHourStart;
          if (typeof slots.resolved.workHourEnd === "number") changes.workHourEnd = slots.resolved.workHourEnd;
          if (Array.isArray(slots.resolved.workDays)) changes.workDays = slots.resolved.workDays;
          if (skill.id === "calendar_working_hours_ooo" && (changes.workHourStart === undefined || changes.workHourEnd === undefined)) {
            return {
              status: "blocked",
              responseText: "What working hours should I set (e.g. 9am-5pm weekdays)?",
              postconditionsPassed: false,
              stepsExecuted,
              stepGraphSize: compiledPlan.nodes.length,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              actionEvents,
              policyBlockCount,
              repairAttemptCount,
              diagnostics: { code: "missing_working_hours", category: "missing_context" },
              failureReason: "missing_working_hours",
            };
          }
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.setWorkingHours(changes),
          );
          break;
        }
        case "calendar.setWorkingLocation": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.setWorkingLocation({
              ...(typeof slots.resolved.working_location === "string"
                ? { workingLocation: slots.resolved.working_location }
                : {}),
            }),
          );
          break;
        }
        case "calendar.setOutOfOffice": {
          const window = getAvailabilityWindowFromSlot(slots.resolved.ooo_window);
          if (skill.id === "calendar_working_hours_ooo" && (!window?.start || !window?.end)) {
            return {
              status: "blocked",
              responseText: "What is your out-of-office window (start and end, ISO-8601)?",
              postconditionsPassed: false,
              stepsExecuted,
              stepGraphSize: compiledPlan.nodes.length,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              actionEvents,
              policyBlockCount,
              repairAttemptCount,
              diagnostics: { code: "missing_ooo_window", category: "missing_context" },
              failureReason: "missing_ooo_window",
            };
          }
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.setOutOfOffice({
              title: "Out of office",
              ...(window?.start ? { start: window.start } : {}),
              ...(window?.end ? { end: window.end } : {}),
              ...(typeof slots.resolved.location === "string" ? { location: slots.resolved.location } : {}),
            }),
          );
          break;
        }
        case "calendar.createFocusBlock": {
          const window = getAvailabilityWindowFromSlot(slots.resolved.focus_block_window);
          if (
            isOutsideWorkingHours({
              startIso: window?.start,
              endIso: window?.end,
              preference: runtime.policyContext?.workingHours,
            })
          ) {
            return {
              status: "blocked",
              responseText:
                "That focus block conflicts with your working-hours rule. Try a window inside your configured workday.",
              postconditionsPassed: false,
              stepsExecuted,
              stepGraphSize: compiledPlan.nodes.length,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              actionEvents,
              policyBlockCount,
              repairAttemptCount,
              diagnostics: { code: "working_hours_conflict", category: "policy" },
              failureReason: "working_hours_conflict",
            };
          }
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.createFocusBlock({
              title: "Focus time",
              ...(window?.start ? { start: window.start } : {}),
              ...(window?.end ? { end: window.end } : {}),
            }),
          );
          break;
        }
        case "calendar.createBookingSchedule": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.calendar.createBookingSchedule({
              bookingLink: typeof slots.resolved.booking_link === "string" ? slots.resolved.booking_link : undefined,
            }),
          );
          break;
        }
        case "planner.composeDayPlan": {
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.planner.composeDayPlan({
              topEmailItems: lastQueriedEmailItems,
              calendarItems: lastQueriedCalendarItems,
            }),
          );
          break;
        }
        case "planner.compileMultiActionPlan": {
          const actions = Array.isArray(slots.resolved.composite_actions)
            ? (slots.resolved.composite_actions as unknown[]).map((value, index) => ({
                id: `action_${index + 1}`,
                raw: value,
              }))
            : [];
          toolResults[step.id] = await runWithTiming(step.id, () =>
            capabilities.planner.compileMultiActionPlan({
              actions,
              constraints: {},
            }),
          );
          break;
        }
        default: {
          // Capabilities intentionally unimplemented in M0/M1 should fail closed.
          throw new Error(`capability_not_implemented: ${step.capability}`);
        }
      }

      const result = toolResults[step.id];
      if (result?.interactive) {
        interactivePayloads.push(result.interactive);
      }
      const policyDecision = mutatingPolicyByCapability[step.capability];
      runtime.logger.info("[skills/action-event]", {
        userId: runtime.emailAccount.userId,
        skillId: skill.id,
        capability: step.capability,
        stepId: step.id,
        success: result?.success ?? false,
        error: result?.error,
        itemCount: result?.meta?.itemCount,
        policy: policyDecision
          ? {
              source: policyDecision.source,
              requiresApproval: policyDecision.requiresApproval,
              operation: policyDecision.target.operation,
              resource: policyDecision.target.resource ?? null,
            }
          : null,
      });
      if (result && isFailure(result)) {
        actionEvents.push({
          stepId: step.id,
          capability: step.capability,
          success: false,
          itemCount: result?.meta?.itemCount ?? 0,
          policyDecision: policyDecision?.requiresApproval ? "blocked" : "allowed",
          ...(result.error ? { errorCode: result.error } : {}),
        });
        const clarification = toolClarificationPrompt(result);
        if (clarification) {
          return {
            status: "blocked",
            responseText: clarification,
              postconditionsPassed: false,
              stepsExecuted,
              stepGraphSize: compiledPlan.nodes.length,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              actionEvents,
              policyBlockCount,
              repairAttemptCount,
              diagnostics: { code: result.error ?? "tool_clarification", category: "provider" },
              failureReason: result.error ?? "tool_clarification",
            };
        }
        throw new Error(result.error ?? `tool_failed:${step.capability}`);
      }
      actionEvents.push({
        stepId: step.id,
        capability: step.capability,
        success: true,
        itemCount: result?.meta?.itemCount ?? 0,
        policyDecision: policyDecision?.requiresApproval ? "blocked" : "allowed",
      });
      if (params.resume?.executeOnlyApprovedStep && step.id === resumeStepId) {
        break;
      }
    }

    if (resumeStepId && !resumeStepFound) {
      return {
        status: "failed",
        responseText: "I couldn't resume that approved action because its execution step was not found.",
        postconditionsPassed: false,
        stepsExecuted,
        stepGraphSize: compiledPlan.nodes.length,
        toolChain,
        stepDurationsMs,
        interactivePayloads,
        actionEvents,
        policyBlockCount,
        repairAttemptCount,
        diagnostics: { code: "approved_step_not_found", category: "unsupported" },
        failureReason: "approved_step_not_found",
      };
    }

    if (params.resume?.executeOnlyApprovedStep && resumeStepId) {
      const resumedResult = toolResults[resumeStepId];
      if (!resumedResult || isFailure(resumedResult)) {
        return {
          status: "failed",
          responseText:
            resumedResult?.message ??
            resumedResult?.error ??
            "I couldn't complete the approved action.",
          postconditionsPassed: false,
          stepsExecuted,
          stepGraphSize: compiledPlan.nodes.length,
          toolChain,
          stepDurationsMs,
          interactivePayloads,
          actionEvents,
          policyBlockCount,
          repairAttemptCount,
          diagnostics: { code: resumedResult?.error ?? "approved_execution_failed", category: "provider" },
          failureReason: resumedResult?.error ?? "approved_execution_failed",
        };
      }
      return {
        status: "success",
        responseText: resumedResult.message ?? renderTemplate(skill, "success"),
        postconditionsPassed: true,
        stepsExecuted,
        stepGraphSize: compiledPlan.nodes.length,
        toolChain,
        stepDurationsMs,
        interactivePayloads,
        actionEvents,
        policyBlockCount,
        repairAttemptCount,
        diagnostics: { code: "ok", category: "unknown" },
      };
    }

    const postconditionsPassed = validateSkillPostconditions({ skill, toolResults });
    const lastMessage = lastCapabilityStepId
      ? toolResults[lastCapabilityStepId]?.message
      : undefined;

    if (!postconditionsPassed) {
      return {
        status: "failed",
        responseText:
          "I couldn't verify that the action completed successfully. Please retry with a more specific target.",
        postconditionsPassed: false,
        stepsExecuted,
        stepGraphSize: compiledPlan.nodes.length,
        toolChain,
        stepDurationsMs,
        interactivePayloads,
        actionEvents,
        policyBlockCount,
        repairAttemptCount,
        diagnostics: { code: "postconditions_failed", category: "provider" },
        failureReason: "postconditions_failed",
      };
    }

    // Skill-specific response rendering when the last tool result isn't user-facing.
    if (skill.id === "inbox_thread_summarize_actions") {
      const threadData = toolResults["load_thread"]?.data;
      const messages =
        threadData && typeof threadData === "object" && Array.isArray((threadData as Record<string, unknown>).messages)
          ? ((threadData as Record<string, unknown>).messages as Array<{
              subject?: string | null;
              snippet?: string | null;
              textPlain?: string | null;
              headers?: Record<string, unknown> | null;
            }>)
          : [];
      const summary = await summarizeThreadWithLLM({
        logger: runtime.logger,
        emailAccount: runtime.emailAccount,
        messages,
      });
      const lines: string[] = [];
      if (summary.decisions.length) {
        lines.push("Decisions:");
        for (const d of summary.decisions.slice(0, 8)) lines.push(`- ${d}`);
      }
      if (summary.actionItems.length) {
        lines.push(lines.length ? "" : "");
        lines.push("Action items:");
        for (const a of summary.actionItems.slice(0, 12)) lines.push(`- ${a}`);
      }
      if (summary.deadlines.length) {
        lines.push(lines.length ? "" : "");
        lines.push("Deadlines:");
        for (const dl of summary.deadlines.slice(0, 8)) lines.push(`- ${dl}`);
      }
      const responseText = lines.filter((l) => l !== "").join("\n");
      return {
        status: "success",
        responseText: responseText || "I couldn't find clear decisions, action items, or deadlines in that thread.",
        postconditionsPassed,
        stepsExecuted,
        stepGraphSize: compiledPlan.nodes.length,
        toolChain,
        stepDurationsMs,
        interactivePayloads,
        actionEvents,
        policyBlockCount,
        repairAttemptCount,
        diagnostics: { code: "ok", category: "unknown" },
      };
    }

    return {
      status: "success",
      responseText: lastMessage ?? renderTemplate(skill, "success"),
      postconditionsPassed,
      stepsExecuted,
      stepGraphSize: compiledPlan.nodes.length,
      toolChain,
      stepDurationsMs,
      interactivePayloads,
      actionEvents,
      policyBlockCount,
      repairAttemptCount,
      diagnostics: { code: "ok", category: "unknown" },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = normalizeSkillFailure({ skill, errorMessage: message });
    const diagnostics = mapFailureToDiagnostics(normalized.reason);

    return {
      status: normalized.status,
      responseText: normalized.userMessage,
      postconditionsPassed: false,
      stepsExecuted,
      stepGraphSize: compiledPlan.nodes.length,
      toolChain,
      stepDurationsMs,
      interactivePayloads,
      actionEvents,
      policyBlockCount,
      repairAttemptCount,
      diagnostics,
      failureReason: normalized.reason,
    };
  }
}

function mapFailureToDiagnostics(reason: string): SkillExecutionResult["diagnostics"] {
  if (reason.includes("missing_")) {
    return { code: reason, category: "missing_context" };
  }
  if (reason.includes("approval") || reason.includes("policy")) {
    return { code: reason, category: "policy" };
  }
  if (reason.includes("rate_limit") || reason.includes("timeout") || reason.includes("transient")) {
    return { code: reason, category: "transient" };
  }
  if (reason.includes("unsupported")) {
    return { code: reason, category: "unsupported" };
  }
  if (reason.includes("provider") || reason.includes("not_found") || reason.includes("invalid_input")) {
    return { code: reason, category: "provider" };
  }
  return { code: reason, category: "unknown" };
}
