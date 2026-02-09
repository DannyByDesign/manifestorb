import prisma from "@/server/db/client";

export interface RuleReference {
  id?: string;
  name?: string;
}

export interface ResolvedEmailRule {
  id: string;
  name: string;
  enabled: boolean;
  isTemporary: boolean;
  expiresAt: Date | null;
  instructions: string | null;
  runOnThreads: boolean;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreRuleMatch(ruleName: string, query: string): number {
  const lhs = ruleName.toLowerCase();
  const rhs = query.toLowerCase();
  if (lhs === rhs) return 100;
  if (lhs.startsWith(rhs)) return 90;
  if (lhs.includes(rhs)) return 80;

  const leftTokens = tokenize(lhs);
  const rightTokens = tokenize(rhs);
  if (rightTokens.length === 0) return 0;
  const tokenMatches = rightTokens.filter((token) =>
    leftTokens.some((candidate) => candidate.includes(token) || token.includes(candidate)),
  ).length;
  return Math.floor((tokenMatches / rightTokens.length) * 70);
}

export async function resumePausedEmailRules(emailAccountId: string) {
  return prisma.rule.updateMany({
    where: {
      emailAccountId,
      enabled: false,
      expiresAt: {
        not: null,
        lte: new Date(),
      },
    },
    data: {
      enabled: true,
      isTemporary: false,
      expiresAt: null,
    },
  });
}

export async function listEmailRules(emailAccountId: string) {
  return prisma.rule.findMany({
    where: { emailAccountId },
    select: {
      id: true,
      name: true,
      instructions: true,
      from: true,
      to: true,
      subject: true,
      conditionalOperator: true,
      enabled: true,
      runOnThreads: true,
      isTemporary: true,
      expiresAt: true,
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
        },
      },
      group: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function resolveEmailRuleReference(params: {
  emailAccountId: string;
  reference: RuleReference;
}) {
  const { emailAccountId, reference } = params;
  const rules = await prisma.rule.findMany({
    where: { emailAccountId },
    select: {
      id: true,
      name: true,
      enabled: true,
      isTemporary: true,
      expiresAt: true,
      instructions: true,
      runOnThreads: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (reference.id) {
    const exactById = rules.find((rule) => rule.id === reference.id);
    return {
      status: exactById ? ("resolved" as const) : ("none" as const),
      matches: exactById ? [exactById] : [],
    };
  }

  const name = reference.name?.trim();
  if (!name) return { status: "none" as const, matches: [] };

  const exact = rules.filter(
    (rule) => rule.name.toLowerCase() === name.toLowerCase(),
  );
  if (exact.length === 1) return { status: "resolved" as const, matches: exact };
  if (exact.length > 1) return { status: "ambiguous" as const, matches: exact };

  const scored = rules
    .map((rule) => ({ rule, score: scoreRuleMatch(rule.name, name) }))
    .filter((item) => item.score >= 50)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "none" as const, matches: [] };

  const topScore = scored[0]?.score ?? 0;
  const topMatches = scored
    .filter((item) => item.score >= topScore - 10)
    .map((item) => item.rule)
    .slice(0, 5);

  if (topMatches.length === 1) {
    return { status: "resolved" as const, matches: topMatches };
  }
  return { status: "ambiguous" as const, matches: topMatches };
}

export async function temporarilyDisableEmailRule(params: {
  emailAccountId: string;
  ruleId: string;
  until: Date;
}) {
  return prisma.rule.update({
    where: { id: params.ruleId, emailAccountId: params.emailAccountId },
    data: {
      enabled: false,
      isTemporary: true,
      expiresAt: params.until,
    },
  });
}

export async function enableEmailRule(params: {
  emailAccountId: string;
  ruleId: string;
}) {
  return prisma.rule.update({
    where: { id: params.ruleId, emailAccountId: params.emailAccountId },
    data: {
      enabled: true,
      isTemporary: false,
      expiresAt: null,
    },
  });
}

export async function renameEmailRule(params: {
  emailAccountId: string;
  ruleId: string;
  name: string;
}) {
  return prisma.rule.update({
    where: { id: params.ruleId, emailAccountId: params.emailAccountId },
    data: { name: params.name },
  });
}
