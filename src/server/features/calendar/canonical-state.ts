import prisma from "@/server/db/client";
import type { CalendarEvent } from "@/features/calendar/event-types";
import { Prisma } from "@/generated/prisma/client";
import { listEffectiveCanonicalRules } from "@/server/features/policy-plane/repository";
import {
  isRuleActiveNow,
  type CanonicalRule,
} from "@/server/features/policy-plane/canonical-schema";

export type CalendarMutationSource = "ai" | "approval" | "webhook" | "reconcile" | "manual" | "system";
type ReschedulePolicy = "FIXED" | "FLEXIBLE" | "APPROVAL_REQUIRED";
type CalendarPolicyCriteria = {
  provider?: string;
  calendarId?: string;
  iCalUid?: string;
  titleContains?: string;
};
type CalendarPolicyRule = {
  id: string;
  source: "event" | "rule";
  shadowEventId?: string;
  criteria?: CalendarPolicyCriteria;
  reschedulePolicy: ReschedulePolicy;
  notifyOnAutoMove: boolean;
  isProtected: boolean;
  enabled: boolean;
  disabledUntil?: string;
  expiresAt?: string;
};

const CALENDAR_POLICY_OPERATION = "calendar_policy";
const CALENDAR_POLICY_LEGACY_REF = "calendar_policy";
export type CalendarPolicyDecision = {
  policyId?: string;
  reschedulePolicy: ReschedulePolicy;
  notifyOnAutoMove: boolean;
  isProtected: boolean;
  source: "default" | "event" | "rule";
};

function toIsoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function normalizeAttendees(event: CalendarEvent): Array<{ email: string; name?: string }> {
  return (event.attendees ?? [])
    .filter((attendee) => Boolean(attendee?.email))
    .map((attendee) => ({
      email: attendee.email.trim().toLowerCase(),
      ...(attendee.name ? { name: attendee.name } : {}),
    }));
}

function isPolicyActive(policy: {
  enabled: boolean;
  disabledUntil?: string;
  expiresAt?: string;
}): boolean {
  return isRuleActiveNow({
    enabled: policy.enabled,
    disabledUntil: policy.disabledUntil,
    expiresAt: policy.expiresAt,
  });
}

function toNullableJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function matchesPolicyCriteria(params: {
  criteria?: CalendarPolicyCriteria;
  event: {
    provider?: string;
    calendarId?: string;
    iCalUid?: string;
    title?: string;
  };
}): boolean {
  const { criteria, event } = params;
  if (!criteria) {
    return true;
  }

  if (typeof criteria.provider === "string" && event.provider && criteria.provider !== event.provider) {
    return false;
  }
  if (typeof criteria.calendarId === "string" && event.calendarId && criteria.calendarId !== event.calendarId) {
    return false;
  }
  if (typeof criteria.iCalUid === "string" && event.iCalUid && criteria.iCalUid !== event.iCalUid) {
    return false;
  }
  if (
    typeof criteria.titleContains === "string" &&
    event.title &&
    !event.title.toLowerCase().includes(criteria.titleContains.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function getTransformPatchValue(
  rule: CanonicalRule,
  path: string,
): unknown {
  const patch = rule.transform?.patch ?? [];
  const entry = patch.find((item) => item.path === path);
  return entry?.value;
}

function toReschedulePolicy(value: unknown): ReschedulePolicy {
  if (
    value === "FIXED" ||
    value === "FLEXIBLE" ||
    value === "APPROVAL_REQUIRED"
  ) {
    return value;
  }
  return "FLEXIBLE";
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function extractCalendarPolicyRule(rule: CanonicalRule): CalendarPolicyRule | null {
  if (rule.match.resource !== "calendar") return null;

  const operation = rule.match.operation?.trim().toLowerCase();
  const isPolicyOperation = operation === CALENDAR_POLICY_OPERATION;
  const isPolicyLegacyRef =
    rule.legacyRefType === CALENDAR_POLICY_LEGACY_REF ||
    rule.legacyRefType === "CalendarEventPolicy";
  if (!isPolicyOperation && !isPolicyLegacyRef) return null;

  let shadowEventId: string | undefined;
  const criteria: CalendarPolicyCriteria = {};
  for (const condition of rule.match.conditions) {
    if (condition.op === "eq" && condition.field === "target.shadowEventId" && typeof condition.value === "string") {
      shadowEventId = condition.value;
      continue;
    }
    if (condition.op === "eq" && condition.field === "target.provider" && typeof condition.value === "string") {
      criteria.provider = condition.value;
      continue;
    }
    if (condition.op === "eq" && condition.field === "target.calendarId" && typeof condition.value === "string") {
      criteria.calendarId = condition.value;
      continue;
    }
    if (condition.op === "eq" && condition.field === "target.iCalUid" && typeof condition.value === "string") {
      criteria.iCalUid = condition.value;
      continue;
    }
    if (condition.op === "contains" && condition.field === "target.title" && typeof condition.value === "string") {
      criteria.titleContains = condition.value;
    }
  }

  const sourceValue = getTransformPatchValue(rule, "calendarPolicy.source");
  const source =
    sourceValue === "event" || sourceValue === "rule"
      ? sourceValue
      : shadowEventId
        ? "event"
        : "rule";

  return {
    id: rule.id,
    source,
    shadowEventId,
    criteria: Object.keys(criteria).length > 0 ? criteria : undefined,
    reschedulePolicy: toReschedulePolicy(
      getTransformPatchValue(rule, "calendarPolicy.reschedulePolicy"),
    ),
    notifyOnAutoMove: toBoolean(
      getTransformPatchValue(rule, "calendarPolicy.notifyOnAutoMove"),
      true,
    ),
    isProtected: toBoolean(
      getTransformPatchValue(rule, "calendarPolicy.isProtected"),
      false,
    ),
    enabled: rule.enabled,
    disabledUntil: rule.disabledUntil,
    expiresAt: rule.expiresAt,
  };
}

async function listCalendarPolicyRules(params: {
  userId: string;
  emailAccountId: string;
}): Promise<CalendarPolicyRule[]> {
  const rules = await listEffectiveCanonicalRules({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    type: "guardrail",
  });
  return rules
    .map((rule) => extractCalendarPolicyRule(rule))
    .filter((rule): rule is CalendarPolicyRule => Boolean(rule));
}

export async function upsertCalendarEventShadow(params: {
  userId: string;
  emailAccountId: string;
  event: CalendarEvent;
  source: CalendarMutationSource;
  metadata?: Record<string, unknown>;
}): Promise<{ shadowId: string; remapped: boolean } | null> {
  const { userId, emailAccountId, event, source, metadata } = params;
  const provider = event.provider;
  const calendarId = event.calendarId;
  const externalEventId = event.id;

  if (!provider || !calendarId || !externalEventId) {
    return null;
  }

  const normalizedAttendees = normalizeAttendees(event);

  const exact = await prisma.calendarEventShadow.findFirst({
    where: {
      userId,
      emailAccountId,
      provider,
      calendarId,
      externalEventId,
    },
    select: { id: true },
  });

  let targetShadowId = exact?.id;
  let remapped = false;

  if (!targetShadowId && event.iCalUid) {
    const byICalUid = await prisma.calendarEventShadow.findFirst({
      where: {
        userId,
        emailAccountId,
        provider,
        iCalUid: event.iCalUid,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, externalEventId: true, calendarId: true },
    });

    if (byICalUid) {
      targetShadowId = byICalUid.id;
      remapped =
        byICalUid.externalEventId !== externalEventId ||
        byICalUid.calendarId !== calendarId;
    }
  }

  const data = {
    userId,
    emailAccountId,
    provider,
    calendarId,
    externalEventId,
    iCalUid: event.iCalUid ?? null,
    seriesMasterId: event.seriesMasterId ?? null,
    versionToken: event.versionToken ?? null,
    status: event.status ?? null,
    title: event.title ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    organizerEmail: event.organizerEmail ?? null,
    attendees: normalizedAttendees,
    allDay: event.isAllDay ?? false,
    startTime: event.startTime ?? null,
    endTime: event.endTime ?? null,
    canEdit: event.canEdit ?? true,
    canRespond: event.canRespond ?? true,
    busyStatus: event.busyStatus ?? null,
    isDeleted: event.isDeleted ?? false,
    lastSeenAt: new Date(),
    lastSyncedAt: new Date(),
    lastMutationSource: source,
    metadata: metadata
      ? (metadata as Prisma.InputJsonValue)
      : Prisma.JsonNull,
  };

  const shadow = targetShadowId
    ? await prisma.calendarEventShadow.update({
        where: { id: targetShadowId },
        data,
        select: { id: true },
      })
    : await prisma.calendarEventShadow.create({
        data,
        select: { id: true },
      });

  return { shadowId: shadow.id, remapped };
}

export async function markCalendarEventShadowDeleted(params: {
  userId: string;
  emailAccountId: string;
  provider: "google" | "microsoft";
  calendarId: string;
  externalEventId: string;
  iCalUid?: string;
  source: CalendarMutationSource;
}): Promise<boolean> {
  const { userId, emailAccountId, provider, calendarId, externalEventId, iCalUid, source } = params;

  const byExternal = await prisma.calendarEventShadow.findFirst({
    where: {
      userId,
      emailAccountId,
      provider,
      calendarId,
      externalEventId,
    },
    select: { id: true },
  });

  const byIcal = !byExternal && iCalUid
    ? await prisma.calendarEventShadow.findFirst({
        where: {
          userId,
          emailAccountId,
          provider,
          iCalUid,
        },
        select: { id: true },
      })
    : null;

  const target = byExternal ?? byIcal;
  if (!target) return false;

  await prisma.calendarEventShadow.update({
    where: { id: target.id },
    data: {
      isDeleted: true,
      status: "cancelled",
      lastSeenAt: new Date(),
      lastSyncedAt: new Date(),
      lastMutationSource: source,
    },
  });

  return true;
}

export async function resolveCalendarEventPolicy(params: {
  userId: string;
  emailAccountId: string;
  shadowEventId?: string;
  eventHint?: {
    provider?: string;
    calendarId?: string;
    iCalUid?: string;
    title?: string;
  };
}): Promise<CalendarPolicyDecision> {
  const { userId, emailAccountId, shadowEventId, eventHint } = params;
  const rules = await listCalendarPolicyRules({ userId, emailAccountId });

  if (shadowEventId) {
    const eventPolicy = rules.filter((policy) => policy.shadowEventId === shadowEventId);
    const active = eventPolicy.find((policy) => isPolicyActive(policy));
    if (active) {
      return {
        policyId: active.id,
        reschedulePolicy: active.reschedulePolicy,
        notifyOnAutoMove: active.notifyOnAutoMove,
        isProtected: active.isProtected,
        source: active.source,
      };
    }
  }

  const globalPolicies = rules.filter((policy) => !policy.shadowEventId);

  for (const policy of globalPolicies) {
    if (!isPolicyActive(policy)) continue;
    if (!matchesPolicyCriteria({ criteria: policy.criteria, event: eventHint ?? {} })) {
      continue;
    }

    return {
      policyId: policy.id,
      reschedulePolicy: policy.reschedulePolicy,
      notifyOnAutoMove: policy.notifyOnAutoMove,
      isProtected: policy.isProtected,
      source: "rule",
    };
  }

  return {
    reschedulePolicy: "FLEXIBLE",
    notifyOnAutoMove: true,
    isProtected: false,
    source: "default",
  };
}

export async function findCalendarEventShadowByIdentity(params: {
  userId: string;
  emailAccountId: string;
  provider?: "google" | "microsoft";
  calendarId?: string;
  externalEventId?: string;
  iCalUid?: string;
}) {
  const { userId, emailAccountId, provider, calendarId, externalEventId, iCalUid } = params;

  if (provider && calendarId && externalEventId) {
    const exact = await prisma.calendarEventShadow.findFirst({
      where: {
        userId,
        emailAccountId,
        provider,
        calendarId,
        externalEventId,
      },
    });
    if (exact) return exact;
  }

  if (provider && iCalUid) {
    return prisma.calendarEventShadow.findFirst({
      where: {
        userId,
        emailAccountId,
        provider,
        iCalUid,
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  return null;
}

export async function startCalendarPlanRun(params: {
  userId: string;
  emailAccountId: string;
  source: string;
  trigger?: unknown;
  input?: unknown;
  correlationId?: string;
}) {
  return prisma.calendarPlanRun.create({
    data: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      source: params.source,
      status: "STARTED",
      trigger: toNullableJson(params.trigger),
      input: toNullableJson(params.input),
      correlationId: params.correlationId,
    },
    select: { id: true, createdAt: true },
  });
}

export async function finishCalendarPlanRun(params: {
  runId: string;
  status: "SUCCESS" | "FAILED" | "NOOP";
  decisions?: unknown;
  result?: unknown;
  error?: string;
  startedAt?: Date;
}) {
  const durationMs = params.startedAt ? Date.now() - params.startedAt.getTime() : undefined;
  return prisma.calendarPlanRun.update({
    where: { id: params.runId },
    data: {
      status: params.status,
      decisions: toNullableJson(params.decisions),
      result: toNullableJson(params.result),
      error: params.error,
      durationMs,
    },
  });
}

export function buildCalendarEventSnapshot(event: CalendarEvent): Record<string, unknown> {
  return {
    id: event.id,
    provider: event.provider,
    calendarId: event.calendarId,
    iCalUid: event.iCalUid,
    seriesMasterId: event.seriesMasterId,
    title: event.title,
    startTime: toIsoOrNull(event.startTime),
    endTime: toIsoOrNull(event.endTime),
    status: event.status,
    canEdit: event.canEdit,
    busyStatus: event.busyStatus,
  };
}
