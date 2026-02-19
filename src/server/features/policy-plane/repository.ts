import { randomUUID } from "crypto";
import prisma from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";
import { createScopedLogger } from "@/server/lib/logger";
import {
  canonicalRuleSchema,
  canonicalRuleTypeSchema,
  normalizeCanonicalRuleCreateInput,
  type CanonicalRule,
  type CanonicalRuleCreateInput,
  type CanonicalRuleType,
} from "@/server/features/policy-plane/canonical-schema";

const logger = createScopedLogger("policy-plane/repository");

function toJsonDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.toISOString();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNullableJson(
  value: Prisma.JsonValue | null | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function toJson(
  value: Prisma.JsonValue | null | undefined,
): Prisma.JsonNullValueInput | Prisma.InputJsonValue {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function mapDbRuleToCanonical(
  row: Awaited<ReturnType<typeof prisma.canonicalRule.findMany>>[number],
): CanonicalRule | null {
  const parsed = canonicalRuleSchema.safeParse({
    id: row.id,
    version: row.version,
    type: row.type,
    enabled: row.enabled,
    priority: row.priority,
    name: row.name ?? undefined,
    description: row.description ?? undefined,
    scope: row.scope ? asObject(row.scope) : undefined,
    trigger: row.trigger ? asObject(row.trigger) : undefined,
    match: asObject(row.match),
    decision: row.decision ?? undefined,
    transform: row.transform ? asObject(row.transform) : undefined,
    actionPlan: row.actionPlan ? asObject(row.actionPlan) : undefined,
    preferencePatch: row.preferencePatch ? asObject(row.preferencePatch) : undefined,
    source: {
      mode: row.sourceMode,
      sourceNl: row.sourceNl ?? undefined,
      sourceMessageId: row.sourceMessageId ?? undefined,
      sourceConversationId: row.sourceConversationId ?? undefined,
      compilerVersion: row.compilerVersion ?? undefined,
      compilerConfidence: row.compilerConfidence ?? undefined,
      compilerWarnings: row.compilerWarnings ? asArray(row.compilerWarnings).map(String) : undefined,
    },
    expiresAt: toJsonDate(row.expiresAt),
    disabledUntil: toJsonDate(row.disabledUntil),
    legacyRefType: row.legacyRefType ?? undefined,
    legacyRefId: row.legacyRefId ?? undefined,
  });

  if (!parsed.success) return null;
  return parsed.data;
}

export async function listPersistedCanonicalRules(params: {
  userId: string;
  emailAccountId?: string;
  type?: CanonicalRuleType;
}): Promise<CanonicalRule[]> {
  const rows = await prisma.canonicalRule.findMany({
    where: {
      userId: params.userId,
      ...(params.emailAccountId
        ? {
            OR: [{ emailAccountId: params.emailAccountId }, { emailAccountId: null }],
          }
        : {}),
      ...(params.type ? { type: params.type } : {}),
    },
    // NOTE: We also apply an in-memory sort below to ensure account-specific rules
    // outrank global rules when priority ties.
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });

  const sorted = [...rows].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;

    if (params.emailAccountId) {
      const aSpecific = a.emailAccountId ? 1 : 0;
      const bSpecific = b.emailAccountId ? 1 : 0;
      if (aSpecific !== bSpecific) return bSpecific - aSpecific;
    }

    const aUpdated = a.updatedAt?.getTime?.() ?? 0;
    const bUpdated = b.updatedAt?.getTime?.() ?? 0;
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;

    return a.id.localeCompare(b.id);
  });

  return sorted
    .map((row) => mapDbRuleToCanonical(row))
    .filter((rule): rule is CanonicalRule => Boolean(rule));
}

export async function listEffectiveCanonicalRules(params: {
  userId: string;
  emailAccountId?: string;
  type?: CanonicalRuleType;
}): Promise<CanonicalRule[]> {
  const type = params.type
    ? canonicalRuleTypeSchema.parse(params.type)
    : undefined;
  const persisted = await listPersistedCanonicalRules({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    type,
  });
  return persisted;
}

export async function createCanonicalRule(params: {
  userId: string;
  emailAccountId?: string;
  rule: CanonicalRuleCreateInput;
}) {
  const normalized = normalizeCanonicalRuleCreateInput(params.rule);
  const id = normalized.id;
  const payload = {
    ...normalized,
    id: id ?? randomUUID(),
    version: normalized.version ?? 1,
  };
  const parsed = canonicalRuleSchema.parse(payload);

  const created = await prisma.canonicalRule.create({
    data: {
      id: parsed.id,
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      version: parsed.version,
      type: parsed.type,
      enabled: parsed.enabled,
      priority: parsed.priority,
      name: parsed.name,
      description: parsed.description,
      scope: parsed.scope as unknown as object | undefined,
      match: parsed.match as unknown as object,
      trigger: parsed.trigger as unknown as object | undefined,
      decision: parsed.decision,
      transform: parsed.transform as unknown as object | undefined,
      actionPlan: parsed.actionPlan as unknown as object | undefined,
      preferencePatch: parsed.preferencePatch as unknown as object | undefined,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
      disabledUntil: parsed.disabledUntil ? new Date(parsed.disabledUntil) : null,
      sourceMode: parsed.source.mode,
      sourceNl: parsed.source.sourceNl,
      sourceMessageId: parsed.source.sourceMessageId,
      sourceConversationId: parsed.source.sourceConversationId,
      compilerVersion: parsed.source.compilerVersion,
      compilerConfidence: parsed.source.compilerConfidence,
      compilerWarnings: parsed.source.compilerWarnings as unknown as object | undefined,
      legacyRefType: parsed.legacyRefType,
      legacyRefId: parsed.legacyRefId,
    },
  });

  await prisma.canonicalRuleVersion.create({
    data: {
      canonicalRuleId: created.id,
      version: created.version,
      payload: parsed as unknown as object,
      sourceMode: parsed.source.mode,
    },
  });

  return created;
}

export async function updateCanonicalRule(params: {
  userId: string;
  id: string;
  patch: Partial<CanonicalRuleCreateInput>;
}) {
  const existing = await prisma.canonicalRule.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) return null;

  const nextVersion = existing.version + 1;
  const data = {
    version: nextVersion,
    type: params.patch.type ?? existing.type,
    enabled: params.patch.enabled ?? existing.enabled,
    priority: params.patch.priority ?? existing.priority,
    name: params.patch.name ?? existing.name,
    description: params.patch.description ?? existing.description,
    scope:
      params.patch.scope !== undefined
        ? (params.patch.scope as unknown as object)
        : existing.scope,
    match:
      params.patch.match !== undefined
        ? (params.patch.match as unknown as object)
        : existing.match,
    trigger:
      params.patch.trigger !== undefined
        ? (params.patch.trigger as unknown as object)
        : existing.trigger,
    decision: params.patch.decision ?? existing.decision,
    transform:
      params.patch.transform !== undefined
        ? (params.patch.transform as unknown as object)
        : existing.transform,
    actionPlan:
      params.patch.actionPlan !== undefined
        ? (params.patch.actionPlan as unknown as object)
        : existing.actionPlan,
    preferencePatch:
      params.patch.preferencePatch !== undefined
        ? (params.patch.preferencePatch as unknown as object)
        : existing.preferencePatch,
    expiresAt:
      params.patch.expiresAt !== undefined
        ? params.patch.expiresAt
          ? new Date(params.patch.expiresAt)
          : null
        : existing.expiresAt,
    disabledUntil:
      params.patch.disabledUntil !== undefined
        ? params.patch.disabledUntil
          ? new Date(params.patch.disabledUntil)
          : null
        : existing.disabledUntil,
    sourceMode: params.patch.source?.mode ?? existing.sourceMode,
    sourceNl: params.patch.source?.sourceNl ?? existing.sourceNl,
    sourceMessageId:
      params.patch.source?.sourceMessageId ?? existing.sourceMessageId,
    sourceConversationId:
      params.patch.source?.sourceConversationId ?? existing.sourceConversationId,
    compilerVersion:
      params.patch.source?.compilerVersion ?? existing.compilerVersion,
    compilerConfidence:
      params.patch.source?.compilerConfidence ?? existing.compilerConfidence,
    compilerWarnings:
      params.patch.source?.compilerWarnings !== undefined
        ? (params.patch.source.compilerWarnings as unknown as object)
        : existing.compilerWarnings,
    legacyRefType: params.patch.legacyRefType ?? existing.legacyRefType,
    legacyRefId: params.patch.legacyRefId ?? existing.legacyRefId,
  };

  const updated = await prisma.canonicalRule.update({
    where: { id: params.id },
    data: {
      ...data,
      scope: toNullableJson(data.scope as Prisma.JsonValue | null | undefined),
      match: toJson(data.match as Prisma.JsonValue | null | undefined),
      trigger: toNullableJson(data.trigger as Prisma.JsonValue | null | undefined),
      transform: toNullableJson(data.transform as Prisma.JsonValue | null | undefined),
      actionPlan: toNullableJson(data.actionPlan as Prisma.JsonValue | null | undefined),
      preferencePatch: toNullableJson(
        data.preferencePatch as Prisma.JsonValue | null | undefined,
      ),
      compilerWarnings: toNullableJson(
        data.compilerWarnings as Prisma.JsonValue | null | undefined,
      ),
    },
  });

  const normalized = mapDbRuleToCanonical(updated);
  if (normalized) {
    await prisma.canonicalRuleVersion.create({
      data: {
        canonicalRuleId: updated.id,
        version: updated.version,
        payload: normalized as unknown as object,
        sourceMode: updated.sourceMode,
      },
    });

    logger.info("Canonical rule updated", {
      ruleId: updated.id,
      userId: params.userId,
    });
  }

  return updated;
}

export async function disableCanonicalRule(params: {
  userId: string;
  id: string;
  disabledUntil?: string;
}) {
  const existing = await prisma.canonicalRule.findFirst({
    where: { id: params.id, userId: params.userId },
  });
  if (!existing) return null;

  const nextVersion = existing.version + 1;
  const disableTemporarily = typeof params.disabledUntil === "string" && params.disabledUntil.trim().length > 0;
  const updated = await prisma.canonicalRule.update({
    where: { id: params.id },
    data: {
      version: nextVersion,
      // Semantics:
      // - If disabledUntil is provided: keep the rule enabled but inactive until that timestamp.
      // - If disabledUntil is absent: permanently disable (enabled=false).
      enabled: disableTemporarily ? true : false,
      disabledUntil: disableTemporarily ? new Date(params.disabledUntil!) : null,
    },
  });

  const normalized = mapDbRuleToCanonical(updated);
  if (normalized) {
    await prisma.canonicalRuleVersion.create({
      data: {
        canonicalRuleId: updated.id,
        version: updated.version,
        payload: normalized as unknown as object,
        sourceMode: updated.sourceMode,
      },
    });

    logger.info("Canonical rule disabled", {
      ruleId: updated.id,
      userId: params.userId,
    });
  }

  return updated;
}

export async function deleteCanonicalRule(params: { userId: string; id: string }) {
  const existing = await prisma.canonicalRule.findFirst({
    where: { id: params.id, userId: params.userId },
    select: { id: true },
  });
  if (!existing) return { deleted: false };

  await prisma.canonicalRule.delete({ where: { id: params.id } });
  return { deleted: true };
}
