import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("data-retention/service");

type PolicyKey =
  | "conversation_message_operational"
  | "approval_operational"
  | "policy_logs_operational"
  | "pending_turn_state";

interface EffectivePolicy {
  key: PolicyKey;
  retentionDays: number;
  hardDelete: boolean;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

const DEFAULT_POLICIES: Record<PolicyKey, EffectivePolicy> = {
  conversation_message_operational: {
    key: "conversation_message_operational",
    retentionDays: 90,
    hardDelete: true,
    enabled: true,
    metadata: { protected_tail_messages: 120 },
  },
  approval_operational: {
    key: "approval_operational",
    retentionDays: 90,
    hardDelete: true,
    enabled: true,
  },
  policy_logs_operational: {
    key: "policy_logs_operational",
    retentionDays: 90,
    hardDelete: true,
    enabled: true,
  },
  pending_turn_state: {
    key: "pending_turn_state",
    retentionDays: 90,
    hardDelete: true,
    enabled: true,
  },
};

function isMissingTableError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "P2021";
}

function daysToCutoff(days: number): Date {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.trunc(days)) : 90;
  return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
}

function readProtectedTailMessages(policy: EffectivePolicy): number {
  const raw = policy.metadata?.protected_tail_messages;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.trunc(raw));
  }
  return 120;
}

async function readEffectivePolicies(): Promise<Record<PolicyKey, EffectivePolicy>> {
  const current = { ...DEFAULT_POLICIES };

  try {
    const rows = await prisma.dataRetentionPolicy.findMany({
      where: {
        key: {
          in: Object.keys(DEFAULT_POLICIES),
        },
      },
      select: {
        key: true,
        retentionDays: true,
        hardDelete: true,
        enabled: true,
        metadata: true,
      },
    });

    for (const row of rows) {
      const key = row.key as PolicyKey;
      if (!current[key]) continue;
      current[key] = {
        key,
        retentionDays: row.retentionDays,
        hardDelete: row.hardDelete,
        enabled: row.enabled,
        metadata:
          row.metadata && typeof row.metadata === "object"
            ? (row.metadata as Record<string, unknown>)
            : undefined,
      };
    }
  } catch (error) {
    if (!isMissingTableError(error)) {
      logger.warn("Failed to read retention policy table; using defaults", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return current;
}

export interface OperationalRetentionResult {
  deletedConversationMessages: number;
  deletedApprovalDecisions: number;
  deletedApprovalRequests: number;
  deletedPolicyExecutionLogs: number;
  deletedPolicyDecisionLogs: number;
  deletedPendingTurnStates: number;
  effectivePolicies: Record<PolicyKey, EffectivePolicy>;
}

export async function applyOperationalRetentionPolicies(params?: {
  userId?: string;
}): Promise<OperationalRetentionResult> {
  const effectivePolicies = await readEffectivePolicies();

  const conversationPolicy = effectivePolicies.conversation_message_operational;
  const approvalPolicy = effectivePolicies.approval_operational;
  const logsPolicy = effectivePolicies.policy_logs_operational;
  const pendingPolicy = effectivePolicies.pending_turn_state;

  let deletedConversationMessages = 0;
  let deletedApprovalDecisions = 0;
  let deletedApprovalRequests = 0;
  let deletedPolicyExecutionLogs = 0;
  let deletedPolicyDecisionLogs = 0;
  let deletedPendingTurnStates = 0;

  try {
    if (conversationPolicy.enabled && conversationPolicy.hardDelete) {
      const protectedTailMessages = readProtectedTailMessages(conversationPolicy);
      const cutoff = daysToCutoff(conversationPolicy.retentionDays);

      if (params?.userId) {
        deletedConversationMessages = Number(
          await prisma.$executeRaw`
            WITH ranked AS (
              SELECT cm."id",
                     ROW_NUMBER() OVER (
                       PARTITION BY cm."conversationId"
                       ORDER BY cm."createdAt" DESC
                     ) AS rn
              FROM "ConversationMessage" cm
              WHERE cm."createdAt" < ${cutoff}
                AND cm."userId" = ${params.userId}
            ),
            purge AS (
              SELECT r."id"
              FROM ranked r
              WHERE r.rn > ${protectedTailMessages}
            )
            DELETE FROM "ConversationMessage" cm
            USING purge p
            WHERE cm."id" = p."id"
          `,
        );
      } else {
        deletedConversationMessages = Number(
          await prisma.$executeRaw`
            WITH ranked AS (
              SELECT cm."id",
                     ROW_NUMBER() OVER (
                       PARTITION BY cm."conversationId"
                       ORDER BY cm."createdAt" DESC
                     ) AS rn
              FROM "ConversationMessage" cm
              WHERE cm."createdAt" < ${cutoff}
            ),
            purge AS (
              SELECT r."id"
              FROM ranked r
              WHERE r.rn > ${protectedTailMessages}
            )
            DELETE FROM "ConversationMessage" cm
            USING purge p
            WHERE cm."id" = p."id"
          `,
        );
      }
    }

    if (approvalPolicy.enabled && approvalPolicy.hardDelete) {
      const cutoff = daysToCutoff(approvalPolicy.retentionDays);
      if (params?.userId) {
        deletedApprovalDecisions = Number(
          await prisma.$executeRaw`
            DELETE FROM "ApprovalDecision" d
            USING "ApprovalRequest" r
            WHERE d."approvalRequestId" = r."id"
              AND r."createdAt" < ${cutoff}
              AND r."status" IN ('APPROVED', 'DENIED', 'EXPIRED', 'CANCELED')
              AND r."userId" = ${params.userId}
          `,
        );
        deletedApprovalRequests = Number(
          await prisma.$executeRaw`
            DELETE FROM "ApprovalRequest" r
            WHERE r."createdAt" < ${cutoff}
              AND r."status" IN ('APPROVED', 'DENIED', 'EXPIRED', 'CANCELED')
              AND r."userId" = ${params.userId}
          `,
        );
      } else {
        deletedApprovalDecisions = Number(
          await prisma.$executeRaw`
            DELETE FROM "ApprovalDecision" d
            USING "ApprovalRequest" r
            WHERE d."approvalRequestId" = r."id"
              AND r."createdAt" < ${cutoff}
              AND r."status" IN ('APPROVED', 'DENIED', 'EXPIRED', 'CANCELED')
          `,
        );
        deletedApprovalRequests = Number(
          await prisma.$executeRaw`
            DELETE FROM "ApprovalRequest" r
            WHERE r."createdAt" < ${cutoff}
              AND r."status" IN ('APPROVED', 'DENIED', 'EXPIRED', 'CANCELED')
          `,
        );
      }
    }

    if (logsPolicy.enabled && logsPolicy.hardDelete) {
      const cutoff = daysToCutoff(logsPolicy.retentionDays);
      if (params?.userId) {
        deletedPolicyExecutionLogs = Number(
          await prisma.policyExecutionLog.deleteMany({
            where: {
              userId: params.userId,
              createdAt: { lt: cutoff },
            },
          }).then((res) => res.count),
        );
        deletedPolicyDecisionLogs = Number(
          await prisma.policyDecisionLog.deleteMany({
            where: {
              userId: params.userId,
              createdAt: { lt: cutoff },
            },
          }).then((res) => res.count),
        );
      } else {
        deletedPolicyExecutionLogs = Number(
          await prisma.policyExecutionLog.deleteMany({
            where: { createdAt: { lt: cutoff } },
          }).then((res) => res.count),
        );
        deletedPolicyDecisionLogs = Number(
          await prisma.policyDecisionLog.deleteMany({
            where: { createdAt: { lt: cutoff } },
          }).then((res) => res.count),
        );
      }
    }

    if (pendingPolicy.enabled && pendingPolicy.hardDelete) {
      const cutoff = daysToCutoff(pendingPolicy.retentionDays);
      deletedPendingTurnStates = Number(
        await prisma.pendingAgentTurnState.deleteMany({
          where: params?.userId
            ? {
                userId: params.userId,
                expiresAt: { lt: cutoff },
              }
            : {
                expiresAt: { lt: cutoff },
              },
        }).then((res) => res.count),
      );
    }
  } catch (error) {
    if (!isMissingTableError(error)) {
      logger.error("Operational retention sweep failed", {
        userId: params?.userId ?? null,
        error,
      });
      throw error;
    }
  }

  return {
    deletedConversationMessages,
    deletedApprovalDecisions,
    deletedApprovalRequests,
    deletedPolicyExecutionLogs,
    deletedPolicyDecisionLogs,
    deletedPendingTurnStates,
    effectivePolicies,
  };
}
