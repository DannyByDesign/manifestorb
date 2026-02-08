import prisma from "@/server/db/client";

export type ApprovalPolicy = "always" | "never" | "conditional";

interface ApprovalConditions {
  externalOnly?: boolean;
  domains?: string[];
}

const DEFAULT_SENSITIVE_TOOLS = ["modify", "delete", "create", "send", "workflow"];

/**
 * Check whether a tool call requires approval for a given user.
 * Returns true if approval is required.
 */
export async function requiresApproval({
  userId,
  toolName,
  args,
}: {
  userId: string;
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<boolean> {
  const pref = await prisma.approvalPreference.findUnique({
    where: { userId_toolName: { userId, toolName } },
  });

  if (!pref) {
    return DEFAULT_SENSITIVE_TOOLS.includes(toolName);
  }

  if (pref.policy === "always") return true;
  if (pref.policy === "never") return false;

  if (pref.policy === "conditional" && pref.conditions) {
    const conditions = pref.conditions as ApprovalConditions;
    if (conditions.externalOnly && conditions.domains?.length) {
      const recipients = (args?.to as string[]) ?? [];
      const isExternal = recipients.some(
        (email) => !conditions.domains!.some((d) => email.endsWith(d)),
      );
      return isExternal;
    }
  }

  return true;
}
