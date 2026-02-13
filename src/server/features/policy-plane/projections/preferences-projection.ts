import prisma from "@/server/db/client";

export interface PreferenceProjectionSnapshot {
  userId: string;
  emailAccountId?: string;
  values: Record<string, unknown>;
}

export async function buildPreferenceProjection(params: {
  userId: string;
  emailAccountId?: string;
}): Promise<PreferenceProjectionSnapshot> {
  const rules = await prisma.canonicalRule.findMany({
    where: {
      userId: params.userId,
      ...(params.emailAccountId ? { emailAccountId: params.emailAccountId } : {}),
      enabled: true,
      type: "preference",
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      preferencePatch: true,
    },
  });

  const values = rules.reduce<Record<string, unknown>>((acc, rule) => {
    if (!rule.preferencePatch || typeof rule.preferencePatch !== "object" || Array.isArray(rule.preferencePatch)) {
      return acc;
    }
    return {
      ...acc,
      ...(rule.preferencePatch as Record<string, unknown>),
    };
  }, {});

  return {
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    values,
  };
}
