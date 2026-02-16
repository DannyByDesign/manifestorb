import prisma from "@/server/db/client";
import type { ChannelProvider } from "@/features/channels/types";

export type SurfaceResolutionStatus = "linked" | "unlinked" | "unknown";

export type SurfaceAccountResolution = {
  userId: string | null;
  matchedProviderAccountId: string | null;
  resolutionStatus: SurfaceResolutionStatus;
  reason?: string;
  ambiguousMatches?: string[];
};

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

export async function resolveSurfaceAccount(params: {
  provider: ChannelProvider;
  providerAccountId: string;
  workspaceId?: string;
}): Promise<SurfaceAccountResolution> {
  const candidates = buildProviderAccountCandidates(params);

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
