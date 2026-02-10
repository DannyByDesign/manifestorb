import prisma from "@/server/db/client";
import type { CalendarEvent } from "@/features/calendar/event-types";

export type CalendarMutationSource = "ai" | "approval" | "webhook" | "reconcile" | "manual" | "system";

export type CalendarPolicyDecision = {
  policyId?: string;
  reschedulePolicy: "FIXED" | "FLEXIBLE" | "APPROVAL_REQUIRED";
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
  disabledUntil: Date | null;
  expiresAt: Date | null;
}): boolean {
  const now = Date.now();
  if (policy.disabledUntil && policy.disabledUntil.getTime() > now) return false;
  if (policy.expiresAt && policy.expiresAt.getTime() < now) return false;
  return true;
}

function matchesPolicyCriteria(params: {
  criteria: unknown;
  event: {
    provider?: string;
    calendarId?: string;
    iCalUid?: string;
    title?: string;
  };
}): boolean {
  const { criteria, event } = params;
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
    return true;
  }

  const record = criteria as Record<string, unknown>;
  if (typeof record.provider === "string" && event.provider && record.provider !== event.provider) {
    return false;
  }
  if (typeof record.calendarId === "string" && event.calendarId && record.calendarId !== event.calendarId) {
    return false;
  }
  if (typeof record.iCalUid === "string" && event.iCalUid && record.iCalUid !== event.iCalUid) {
    return false;
  }
  if (
    typeof record.titleContains === "string" &&
    event.title &&
    !event.title.toLowerCase().includes(record.titleContains.toLowerCase())
  ) {
    return false;
  }
  return true;
}

async function ensureDefaultPolicyForShadow(params: {
  userId: string;
  emailAccountId: string;
  shadowEventId: string;
}) {
  const existing = await prisma.calendarEventPolicy.findFirst({
    where: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      shadowEventId: params.shadowEventId,
    },
    select: { id: true },
  });

  if (!existing) {
    await prisma.calendarEventPolicy.create({
      data: {
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        shadowEventId: params.shadowEventId,
        source: "default",
        reschedulePolicy: "FLEXIBLE",
        notifyOnAutoMove: true,
        isProtected: false,
        priority: 0,
      },
    });
  }
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
    metadata: metadata ?? null,
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

  await ensureDefaultPolicyForShadow({
    userId,
    emailAccountId,
    shadowEventId: shadow.id,
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

  if (shadowEventId) {
    const eventPolicy = await prisma.calendarEventPolicy.findMany({
      where: {
        userId,
        emailAccountId,
        shadowEventId,
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 3,
    });

    const active = eventPolicy.find((policy) => isPolicyActive(policy));
    if (active) {
      return {
        policyId: active.id,
        reschedulePolicy: active.reschedulePolicy,
        notifyOnAutoMove: active.notifyOnAutoMove,
        isProtected: active.isProtected,
        source: active.source === "default" ? "event" : "rule",
      };
    }
  }

  const globalPolicies = await prisma.calendarEventPolicy.findMany({
    where: {
      userId,
      emailAccountId,
      shadowEventId: null,
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    take: 25,
  });

  for (const policy of globalPolicies) {
    if (!isPolicyActive(policy)) continue;
    if (!matchesPolicyCriteria({ criteria: policy.criteria, event: eventHint ?? {} })) continue;

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
      trigger: params.trigger as object | null | undefined,
      input: params.input as object | null | undefined,
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
      decisions: params.decisions as object | null | undefined,
      result: params.result as object | null | undefined,
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
