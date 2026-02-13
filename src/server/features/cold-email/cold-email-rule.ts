import prisma from "@/server/db/client";

export type ColdEmailRule = NonNullable<
  Awaited<ReturnType<typeof getColdEmailRule>>
>;

export async function getColdEmailRule(emailAccountId: string) {
  const coldEmailRule = await prisma.canonicalRule.findFirst({
    where: {
      emailAccountId,
      enabled: true,
      OR: [
        {
          name: {
            contains: "cold",
            mode: "insensitive",
          },
        },
        {
          sourceNl: {
            contains: "cold",
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      id: true,
      enabled: true,
      description: true,
      actionPlan: true,
    },
  });

  if (!coldEmailRule) return null;

  const actionPlan =
    coldEmailRule.actionPlan &&
    typeof coldEmailRule.actionPlan === "object" &&
    !Array.isArray(coldEmailRule.actionPlan)
      ? (coldEmailRule.actionPlan as Record<string, unknown>)
      : {};

  const actions = Array.isArray(actionPlan.actions)
    ? actionPlan.actions
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : null,
        )
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          type: typeof item.type === "string" ? item.type : "unknown",
          label: typeof item.label === "string" ? item.label : null,
          labelId: typeof item.labelId === "string" ? item.labelId : null,
        }))
    : [];

  return {
    id: coldEmailRule.id,
    enabled: coldEmailRule.enabled,
    instructions: coldEmailRule.description,
    groupId: null,
    actions,
  };
}

export function isColdEmailRuleEnabled(coldEmailRule: ColdEmailRule) {
  return !!coldEmailRule.enabled && coldEmailRule.actions.length > 0;
}
