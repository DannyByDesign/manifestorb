import prisma from "@/server/db/client";
import type { ChannelProvider } from "@/features/channels/types";
import { createScopedLogger } from "@/server/lib/logger";
import type { Prisma } from "@/generated/prisma/client";

const logger = createScopedLogger("surface-account");

export type SurfaceResolutionStatus = "linked" | "unlinked" | "unknown";

export type SurfaceAccountResolution = {
  userId: string | null;
  matchedProviderAccountId: string | null;
  resolutionStatus: SurfaceResolutionStatus;
  reason?: string;
  ambiguousMatches?: string[];
};

function isMissingTableError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "P2021";
}

function toJsonValue(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function coerceUserId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.userId === "string" && record.userId.length > 0) {
    return record.userId;
  }
  const user =
    record.user && typeof record.user === "object"
      ? (record.user as Record<string, unknown>)
      : null;
  if (user && typeof user.id === "string" && user.id.length > 0) {
    return user.id;
  }
  return null;
}

function normalizeId(value: string): string {
  return value.trim();
}

export function buildProviderAccountCandidates(params: {
  provider: ChannelProvider;
  providerAccountId: string;
  workspaceId?: string;
}): string[] {
  const raw = normalizeId(params.providerAccountId);
  const candidates = new Set<string>();

  if (params.provider === "slack") {
    const workspaceId = params.workspaceId?.trim();
    if (workspaceId && !raw.includes(":")) {
      candidates.add(`${workspaceId}:${raw}`);
      candidates.add(raw);
    } else {
      candidates.add(raw);
      if (raw.includes(":")) {
        const legacy = raw.split(":").pop();
        if (legacy) candidates.add(legacy);
      }
    }
  } else {
    candidates.add(raw);
  }

  return [...candidates].filter((candidate) => candidate.length > 0);
}

export function preferredProviderAccountId(params: {
  provider: ChannelProvider;
  providerAccountId: string;
  workspaceId?: string;
}): string {
  const raw = normalizeId(params.providerAccountId);
  if (params.provider === "slack") {
    const workspaceId = params.workspaceId?.trim();
    if (workspaceId && !raw.includes(":")) {
      return `${workspaceId}:${raw}`;
    }
  }
  return raw;
}

async function resolveFromChannelIdentities(params: {
  provider: ChannelProvider;
  candidates: string[];
}): Promise<{ userId: string; matchedProviderAccountId: string } | null> {
  for (const candidate of params.candidates) {
    try {
      const identity = await prisma.userChannelIdentity.findUnique({
        where: {
          provider_externalUserKey: {
            provider: params.provider,
            externalUserKey: candidate,
          },
        },
        select: { userId: true },
      });
      if (identity?.userId) {
        return { userId: identity.userId, matchedProviderAccountId: candidate };
      }
    } catch (error) {
      if (isMissingTableError(error)) return null;
      logger.warn("Failed resolving channel identity mapping", {
        provider: params.provider,
        candidate,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  return null;
}

export async function resolveSurfaceAccount(params: {
  provider: ChannelProvider;
  providerAccountId: string;
  workspaceId?: string;
}): Promise<SurfaceAccountResolution> {
  const candidates = buildProviderAccountCandidates(params);

  const channelIdentityMatch = await resolveFromChannelIdentities({
    provider: params.provider,
    candidates,
  });
  if (channelIdentityMatch) {
    return {
      userId: channelIdentityMatch.userId,
      matchedProviderAccountId: channelIdentityMatch.matchedProviderAccountId,
      resolutionStatus: "linked",
    };
  }

  for (const candidate of candidates) {
    const account = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: params.provider,
          providerAccountId: candidate,
        },
      },
      select: {
        userId: true,
      },
    });
    const userId = coerceUserId(account);
    if (userId) {
      return {
        userId,
        matchedProviderAccountId: candidate,
        resolutionStatus: "linked",
      };
    }
  }

  if (params.provider === "slack" && !params.providerAccountId.includes(":")) {
    const raw = normalizeId(params.providerAccountId);
    const suffixMatchesRaw = await prisma.account.findMany({
      where: {
        provider: "slack",
        providerAccountId: {
          endsWith: `:${raw}`,
        },
      },
      select: {
        userId: true,
        providerAccountId: true,
      },
      take: 2,
    });
    const suffixMatches = Array.isArray(suffixMatchesRaw) ? suffixMatchesRaw : [];

    if (suffixMatches.length === 1) {
      const userId = coerceUserId(suffixMatches[0]);
      if (!userId) {
        return {
          userId: null,
          matchedProviderAccountId: null,
          resolutionStatus: "unlinked",
        };
      }
      return {
        userId,
        matchedProviderAccountId: suffixMatches[0].providerAccountId,
        resolutionStatus: "linked",
      };
    }

    if (suffixMatches.length > 1) {
      return {
        userId: null,
        matchedProviderAccountId: null,
        resolutionStatus: "unknown",
        reason: "ambiguous_slack_account_suffix",
        ambiguousMatches: suffixMatches.map((match) => match.providerAccountId),
      };
    }
  }

  return {
    userId: null,
    matchedProviderAccountId: null,
    resolutionStatus: "unlinked",
  };
}

export async function recordSurfaceIdentityMapping(params: {
  userId: string;
  provider: ChannelProvider;
  providerAccountId: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const externalUserKey = preferredProviderAccountId({
    provider: params.provider,
    providerAccountId: params.providerAccountId,
    workspaceId: params.workspaceId,
  });

  if (!externalUserKey) return;

  try {
    const existing = await prisma.userChannelIdentity.findUnique({
      where: {
        provider_externalUserKey: {
          provider: params.provider,
          externalUserKey,
        },
      },
      select: { id: true, userId: true },
    });

    if (existing && existing.userId !== params.userId) {
      logger.warn("Channel identity mapping already assigned to different user", {
        provider: params.provider,
        externalUserKey,
        existingUserId: existing.userId,
        incomingUserId: params.userId,
      });
      return;
    }

    await prisma.userChannelIdentity.upsert({
      where: {
        provider_externalUserKey: {
          provider: params.provider,
          externalUserKey,
        },
      },
      create: {
        userId: params.userId,
        provider: params.provider,
        externalUserKey,
        verifiedAt: new Date(),
        metadata: toJsonValue({
          workspaceId: params.workspaceId ?? null,
          ...params.metadata,
        }),
      },
      update: {
        userId: params.userId,
        verifiedAt: new Date(),
        metadata: toJsonValue({
          workspaceId: params.workspaceId ?? null,
          ...params.metadata,
        }),
      },
    });
  } catch (error) {
    if (isMissingTableError(error)) return;
    logger.warn("Failed to persist channel identity mapping", {
      userId: params.userId,
      provider: params.provider,
      externalUserKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
