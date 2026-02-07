/**
 * Web Chat AI — thin adapter that delegates to the unified message processor.
 *
 * Handles streaming responses for the web UI.
 */
import type { ModelMessage } from "ai";
import type { Logger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { MessageContext } from "@/app/api/chat/validation";
import { stringifyEmail } from "@/server/lib/stringify-email";
import { getEmailForLLM } from "@/server/lib/get-email-from-message";
import type { ParsedMessage } from "@/server/types";
import { env } from "@/env";
import { processMessage } from "@/features/ai/message-processor";

export const maxDuration = 120;

export async function aiProcessAssistantChat({
  messages,
  emailAccountId,
  user,
  context,
  logger,
}: {
  messages: ModelMessage[];
  emailAccountId: string;
  user: EmailAccountWithAI;
  context?: MessageContext;
  logger: Logger;
}) {
  // Resolve the connected email account (same logic as before)
  const connectedEmailAccount = await resolveEmailAccount(user, emailAccountId);

  // Build hidden-context messages for fix-rule (if applicable)
  const hiddenContextMessages = buildHiddenContextMessages(context);

  const result = await processMessage({
    user: { id: user.id },
    emailAccount: {
      ...connectedEmailAccount,
      ...connectedEmailAccount.account,
      id: connectedEmailAccount.id,
      email: connectedEmailAccount.email,
      expires_at: connectedEmailAccount.account.expires_at
        ? new Date(connectedEmailAccount.account.expires_at).getTime()
        : null,
    },
    messages,
    context: { provider: "web" },
    streaming: true,
    emailSendEnabled: env.NEXT_PUBLIC_EMAIL_SEND_ENABLED === true,
    hiddenContextMessages:
      hiddenContextMessages.length > 0 ? hiddenContextMessages : undefined,
    logger,
  });

  return result.stream!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveEmailAccount(
  user: EmailAccountWithAI,
  emailAccountId: string,
) {
  if (emailAccountId) {
    const acct = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      include: { account: true },
    });
    if (acct) return acct;
  }

  // Fallback: find by provider
  const acct = await prisma.emailAccount.findFirst({
    where: {
      userId: user.id,
      account: { provider: user.account.provider },
    },
    include: { account: true },
  });
  if (acct) return acct;

  // Last resort: any account for this user
  const any = await prisma.emailAccount.findFirst({
    where: { userId: user.id },
    include: { account: true },
  });
  if (any) return any;

  throw new Error(`No EmailAccount connected for user ${user.id}`);
}

function buildHiddenContextMessages(
  context?: MessageContext,
): Array<{ role: "system"; content: string }> {
  if (!context || context.type !== "fix-rule") return [];

  return [
    {
      role: "system" as const,
      content:
        "Hidden context for the user's request (do not repeat this to the user):\n\n" +
        `<email>\n${stringifyEmail(
          getEmailForLLM(context.message as ParsedMessage, { maxLength: 3000 }),
          3000,
        )}\n</email>\n\n` +
        `Rules that were applied:\n${context.results
          .map((r) => `- ${r.ruleName ?? "None"}: ${r.reason}`)
          .join("\n")}\n\n` +
        `Expected outcome: ${
          context.expected === "new"
            ? "Create a new rule"
            : context.expected === "none"
              ? "No rule should be applied"
              : `Should match the "${context.expected.name}" rule`
        }`,
    },
  ];
}
