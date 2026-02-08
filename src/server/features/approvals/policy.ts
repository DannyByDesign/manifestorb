import prisma from "@/server/db/client";

export type ApprovalPolicy = "always" | "never" | "conditional";

interface ApprovalConditions {
  externalOnly?: boolean;
  domains?: string[];
}

const DEFAULT_SENSITIVE_TOOLS = ["modify", "delete", "create", "send", "workflow"];

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/<([^>]+)>/);
  const value = (angleMatch?.[1] ?? trimmed).trim();
  if (!value.includes("@")) return null;
  return value;
}

function collectEmailsFromValue(value: unknown, into: Set<string>) {
  if (typeof value === "string") {
    for (const part of value.split(/[;,]/)) {
      const normalized = normalizeEmail(part);
      if (normalized) into.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEmailsFromValue(item, into);
    }
    return;
  }
}

function extractRecipientEmails(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];

  const roots: Array<Record<string, unknown> | undefined> = [
    args,
    args.data as Record<string, unknown> | undefined,
    args.changes as Record<string, unknown> | undefined,
    args.options as Record<string, unknown> | undefined,
  ];

  const keys = ["to", "cc", "bcc", "recipients", "attendees", "participantEmails"];
  const recipients = new Set<string>();

  for (const root of roots) {
    if (!root) continue;
    for (const key of keys) {
      collectEmailsFromValue(root[key], recipients);
    }
  }

  return Array.from(recipients);
}

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
      const recipients = extractRecipientEmails(args);
      if (recipients.length === 0) {
        return true;
      }

      const internalDomains = new Set(
        conditions.domains.map((domain) =>
          domain.toLowerCase().replace(/^@/, "").trim(),
        ),
      );
      const isExternal = recipients.some((email) => {
        const [, domain = ""] = email.split("@");
        return !internalDomains.has(domain);
      });
      return isExternal;
    }
  }

  return true;
}
