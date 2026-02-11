import { randomUUID } from "crypto";
import prisma from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";

type ReschedulePolicy = "FIXED" | "FLEXIBLE" | "APPROVAL_REQUIRED";

type CalendarPolicyCriteria = {
  provider?: "google" | "microsoft";
  calendarId?: string;
  iCalUid?: string;
  titleContains?: string;
};

type CalendarPolicyRuleReference = {
  id?: string;
  name?: string;
};

export type CalendarPolicyRuleConfig = {
  id: string;
  name: string;
  scope: "global" | "event";
  reschedulePolicy: ReschedulePolicy;
  notifyOnAutoMove: boolean;
  isProtected: boolean;
  priority: number;
  enabled: boolean;
  disabledUntil?: string;
  expiresAt?: string;
  criteria?: CalendarPolicyCriteria;
  shadowEventId?: string;
  eventIdentity?: {
    provider?: string;
    calendarId?: string;
    externalEventId?: string;
    iCalUid?: string;
    title?: string;
  };
};

type RuleReferenceMatch = {
  score: number;
  rule: CalendarPolicyRuleConfig;
};

type ResolveCalendarPolicyReferenceResult =
  | { status: "none"; matches: [] }
  | { status: "resolved"; matches: [RuleReferenceMatch] }
  | { status: "ambiguous"; matches: RuleReferenceMatch[] };

function normalizeRuleName(name: string | undefined): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return `Calendar policy ${randomUUID().slice(0, 8)}`;
}

function parseFutureDateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function isRuleEnabled(disabledUntil: Date | null): boolean {
  if (!disabledUntil) return true;
  return disabledUntil.getTime() <= Date.now();
}

async function resolveShadowEventId(params: {
  userId: string;
  emailAccountId: string;
  shadowEventId?: string;
  eventId?: string;
  provider?: "google" | "microsoft";
  calendarId?: string;
  iCalUid?: string;
}): Promise<string | null> {
  if (params.shadowEventId) {
    const shadow = await prisma.calendarEventShadow.findFirst({
      where: {
        id: params.shadowEventId,
        userId: params.userId,
        emailAccountId: params.emailAccountId,
      },
      select: { id: true },
    });
    return shadow?.id ?? null;
  }

  if (!params.eventId) return null;
  const matches = await prisma.calendarEventShadow.findMany({
    where: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      externalEventId: params.eventId,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.calendarId ? { calendarId: params.calendarId } : {}),
      ...(params.iCalUid ? { iCalUid: params.iCalUid } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
    take: 2,
  });

  if (matches.length !== 1) return null;
  return matches[0]!.id;
}

function toRuleConfig(
  row: {
    id: string;
    title: string | null;
    reschedulePolicy: ReschedulePolicy;
    notifyOnAutoMove: boolean;
    isProtected: boolean;
    priority: number;
    disabledUntil: Date | null;
    expiresAt: Date | null;
    criteria: unknown;
    shadowEventId: string | null;
    shadowEvent?: {
      provider: string;
      calendarId: string;
      externalEventId: string;
      iCalUid: string | null;
      title: string | null;
    } | null;
  },
): CalendarPolicyRuleConfig {
  const criteria =
    row.criteria && typeof row.criteria === "object" && !Array.isArray(row.criteria)
      ? (row.criteria as CalendarPolicyCriteria)
      : undefined;

  return {
    id: row.id,
    name: row.title ?? "Untitled calendar policy",
    scope: row.shadowEventId ? "event" : "global",
    reschedulePolicy: row.reschedulePolicy,
    notifyOnAutoMove: row.notifyOnAutoMove,
    isProtected: row.isProtected,
    priority: row.priority,
    enabled: isRuleEnabled(row.disabledUntil),
    ...(row.disabledUntil ? { disabledUntil: row.disabledUntil.toISOString() } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
    ...(criteria ? { criteria } : {}),
    ...(row.shadowEventId ? { shadowEventId: row.shadowEventId } : {}),
    ...(row.shadowEvent
      ? {
          eventIdentity: {
            provider: row.shadowEvent.provider,
            calendarId: row.shadowEvent.calendarId,
            externalEventId: row.shadowEvent.externalEventId,
            ...(row.shadowEvent.iCalUid ? { iCalUid: row.shadowEvent.iCalUid } : {}),
            ...(row.shadowEvent.title ? { title: row.shadowEvent.title } : {}),
          },
        }
      : {}),
  };
}

export async function listCalendarPolicyRules(params: {
  userId: string;
  emailAccountId: string;
}): Promise<CalendarPolicyRuleConfig[]> {
  const rows = await prisma.calendarEventPolicy.findMany({
    where: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      source: "rule",
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    include: {
      shadowEvent: {
        select: {
          provider: true,
          calendarId: true,
          externalEventId: true,
          iCalUid: true,
          title: true,
        },
      },
    },
  });

  return rows.map(toRuleConfig);
}

export async function resolveCalendarPolicyRuleReference(params: {
  userId: string;
  emailAccountId: string;
  reference: CalendarPolicyRuleReference;
}): Promise<ResolveCalendarPolicyReferenceResult> {
  const rules = await listCalendarPolicyRules({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
  });
  if (rules.length === 0) {
    return { status: "none", matches: [] };
  }

  if (params.reference.id) {
    const exact = rules.find((rule) => rule.id === params.reference.id);
    if (!exact) return { status: "none", matches: [] };
    return { status: "resolved", matches: [{ score: 1, rule: exact }] };
  }

  const name = params.reference.name?.trim();
  if (!name) return { status: "none", matches: [] };

  const scored = rules
    .map((rule) => ({
      score: scoreLooseNameMatch(rule.name, name),
      rule,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { status: "none", matches: [] };
  }
  if (scored.length === 1 || scored[0]!.score >= scored[1]!.score + 0.18) {
    return { status: "resolved", matches: [scored[0]!] };
  }
  return { status: "ambiguous", matches: scored.slice(0, 5) };
}

export async function upsertCalendarPolicyRule(params: {
  userId: string;
  emailAccountId: string;
  rule: {
    id?: string;
    name?: string;
    scope?: "global" | "event";
    shadowEventId?: string;
    eventId?: string;
    provider?: "google" | "microsoft";
    calendarId?: string;
    iCalUid?: string;
    reschedulePolicy: ReschedulePolicy;
    notifyOnAutoMove?: boolean;
    isProtected?: boolean;
    priority?: number;
    enabled?: boolean;
    disabledUntil?: string;
    expiresAt?: string;
    criteria?: CalendarPolicyCriteria;
  };
}) {
  const scope = params.rule.scope ?? "global";
  const shadowEventId =
    scope === "event"
      ? await resolveShadowEventId({
          userId: params.userId,
          emailAccountId: params.emailAccountId,
          shadowEventId: params.rule.shadowEventId,
          eventId: params.rule.eventId,
          provider: params.rule.provider,
          calendarId: params.rule.calendarId,
          iCalUid: params.rule.iCalUid,
        })
      : null;

  if (scope === "event" && !shadowEventId) {
    throw new Error(
      "I couldn't match that event to a single calendar item. Please provide the exact event first.",
    );
  }

  const disabledUntil = params.rule.enabled === false
    ? parseFutureDateOrNull(params.rule.disabledUntil) ?? new Date(Date.now() + 24 * 60 * 60 * 1000)
    : parseFutureDateOrNull(params.rule.disabledUntil);
  const expiresAt = parseFutureDateOrNull(params.rule.expiresAt);
  const criteriaJson = params.rule.criteria
    ? (params.rule.criteria as Prisma.InputJsonValue)
    : Prisma.JsonNull;

  const rule = params.rule.id
    ? await prisma.calendarEventPolicy.update({
        where: { id: params.rule.id },
        data: {
          title: normalizeRuleName(params.rule.name),
          source: "rule",
          shadowEventId,
          reschedulePolicy: params.rule.reschedulePolicy,
          notifyOnAutoMove: params.rule.notifyOnAutoMove ?? true,
          isProtected: params.rule.isProtected ?? false,
          priority: params.rule.priority ?? 0,
          disabledUntil: disabledUntil ?? null,
          expiresAt: expiresAt ?? null,
          criteria: criteriaJson,
        },
        include: {
          shadowEvent: {
            select: {
              provider: true,
              calendarId: true,
              externalEventId: true,
              iCalUid: true,
              title: true,
            },
          },
        },
      })
    : await prisma.calendarEventPolicy.create({
        data: {
          userId: params.userId,
          emailAccountId: params.emailAccountId,
          title: normalizeRuleName(params.rule.name),
          source: "rule",
          shadowEventId,
          reschedulePolicy: params.rule.reschedulePolicy,
          notifyOnAutoMove: params.rule.notifyOnAutoMove ?? true,
          isProtected: params.rule.isProtected ?? false,
          priority: params.rule.priority ?? 0,
          disabledUntil: disabledUntil ?? null,
          expiresAt: expiresAt ?? null,
          criteria: criteriaJson,
        },
        include: {
          shadowEvent: {
            select: {
              provider: true,
              calendarId: true,
              externalEventId: true,
              iCalUid: true,
              title: true,
            },
          },
        },
      });

  return toRuleConfig(rule);
}

export async function removeCalendarPolicyRule(params: {
  userId: string;
  emailAccountId: string;
  ruleId: string;
}) {
  const existing = await prisma.calendarEventPolicy.findFirst({
    where: {
      id: params.ruleId,
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      source: "rule",
    },
    select: { id: true },
  });
  if (!existing) return { removed: false };
  await prisma.calendarEventPolicy.delete({
    where: { id: params.ruleId },
  });
  return { removed: true };
}

export async function disableCalendarPolicyRule(params: {
  userId: string;
  emailAccountId: string;
  ruleId: string;
  disabledUntil: Date;
}) {
  const updated = await prisma.calendarEventPolicy.updateMany({
    where: {
      id: params.ruleId,
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      source: "rule",
    },
    data: {
      disabledUntil: params.disabledUntil,
    },
  });
  if (updated.count === 0) return { updated: false as const };

  const rule = await prisma.calendarEventPolicy.findUnique({
    where: { id: params.ruleId },
    select: { id: true, title: true, disabledUntil: true },
  });
  return { updated: true as const, rule };
}

export async function enableCalendarPolicyRule(params: {
  userId: string;
  emailAccountId: string;
  ruleId: string;
}) {
  const updated = await prisma.calendarEventPolicy.updateMany({
    where: {
      id: params.ruleId,
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      source: "rule",
    },
    data: {
      disabledUntil: null,
    },
  });
  if (updated.count === 0) return { updated: false as const };
  const rule = await prisma.calendarEventPolicy.findUnique({
    where: { id: params.ruleId },
    select: { id: true, title: true },
  });
  return { updated: true as const, rule };
}

export async function renameCalendarPolicyRule(params: {
  userId: string;
  emailAccountId: string;
  ruleId: string;
  newName: string;
}) {
  const updated = await prisma.calendarEventPolicy.updateMany({
    where: {
      id: params.ruleId,
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      source: "rule",
    },
    data: {
      title: normalizeRuleName(params.newName),
    },
  });
  if (updated.count === 0) return { updated: false as const };
  const rule = await prisma.calendarEventPolicy.findUnique({
    where: { id: params.ruleId },
    select: { id: true, title: true },
  });
  return { updated: true as const, rule };
}
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreLooseNameMatch(name: string, query: string): number {
  const lhs = name.toLowerCase();
  const rhs = query.toLowerCase().trim();
  if (!rhs) return 0;
  if (lhs === rhs) return 1;
  if (lhs.startsWith(rhs)) return 0.92;
  if (lhs.includes(rhs)) return 0.85;
  const lhsTokens = tokenize(lhs);
  const rhsTokens = tokenize(rhs);
  if (rhsTokens.length === 0) return 0;
  const matched = rhsTokens.filter((token) =>
    lhsTokens.some((candidate) => candidate.includes(token) || token.includes(candidate)),
  ).length;
  return matched / rhsTokens.length;
}
