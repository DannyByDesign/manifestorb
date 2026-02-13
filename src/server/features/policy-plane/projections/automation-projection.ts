import prisma from "@/server/db/client";

export interface AutomationProjectionItem {
  id: string;
  priority: number;
  trigger: unknown;
  actionPlan: unknown;
}

export async function buildAutomationProjection(params: {
  userId: string;
  emailAccountId?: string;
}): Promise<AutomationProjectionItem[]> {
  const rules = await prisma.canonicalRule.findMany({
    where: {
      userId: params.userId,
      ...(params.emailAccountId ? { emailAccountId: params.emailAccountId } : {}),
      enabled: true,
      type: "automation",
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      priority: true,
      trigger: true,
      actionPlan: true,
    },
  });

  return rules.map((rule) => ({
    id: rule.id,
    priority: rule.priority,
    trigger: rule.trigger,
    actionPlan: rule.actionPlan,
  }));
}
