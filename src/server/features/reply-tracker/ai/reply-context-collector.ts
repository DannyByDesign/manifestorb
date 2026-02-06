import { tool } from "ai";
import { subMonths } from "date-fns/subMonths";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";
import { createGenerateText } from "@/server/lib/llms";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import { getTodayForLLM } from "@/features/ai/helpers";
import { getModel } from "@/server/lib/llms/model";
import type { EmailProvider } from "@/features/email/types";
import { getEmailForLLM } from "@/server/lib/get-email-from-message";
import { captureException } from "@/server/lib/error";
import { getEmailListPrompt, getUserInfoPrompt } from "@/features/ai/helpers";

const logger = createScopedLogger("reply-context-collector");

export type ReplyContextCollectorResult = {
  notes?: string | null;
  relevantEmails: string[];
};

const resultSchema = z.object({
  notes: z
    .string()
    .describe("Any notes about the emails that may be helpful")
    .nullish(),
  relevantEmails: z
    .array(z.string())
    .describe(
      "Past email conversations from search results that could help draft the response. Leave empty if no relevant past emails found.",
    ),
}) satisfies z.ZodType<ReplyContextCollectorResult>;

const agentSystem = `You are an intelligent email assistant that gathers historical context from the user's email history to inform a later drafting step.

Your task is to:
1. Analyze the current email thread to understand the main topic, question, or request
2. Search through the user's email history to find similar conversations from the past 6 months
3. Collect and synthesize the most relevant findings from your searches
4. When you are done, CALL finalizeResults with your final results

You have access to these tools:
- searchEmails: Search for emails using queries to find relevant historical context
- finalizeResults: Finalize and return your results

CRITICAL GUIDELINES:
- The current email thread is already provided to the drafting agent - DO NOT include it in relevantEmails
- The relevantEmails array should ONLY contain past emails found through your searches that could help draft a response
- If no relevant past emails are found through searching, leave the relevantEmails array empty
- Perform as many searches as needed to confidently gather context, but be efficient
- Focus on emails that show how similar questions were answered before
- Only include information that directly helps a downstream drafting agent

IMPORTANT - For scheduling/meeting requests:
- DO NOT include emails that show old availability times or scheduling patterns
- DO include context about the person (relationship, past meeting topics, ongoing projects)
- If you only find old scheduling emails with no useful context, return empty relevantEmails array

When searching, use natural language queries that would find relevant emails. The search will look through the past 6 months automatically.

Search Tips:
- Use short keyword phrases; the provider search syntax applies
- IMPORTANT: Try simpler queries if you don't get results for your first search
- Try the subject line first if it contains the main topic

Example search queries:
- "order status" OR "shipment arrival" OR "tracking number"
- "refund" OR "return policy" OR "return window"
- "billing issue" OR "invoice question" OR "duplicate charge"
- "account access" OR "password reset" OR "2FA disabled"
- "API error" OR "500 errors" OR "database timeout"
- "enterprise pricing" OR "annual payment" OR "volume discount"`;

export async function aiCollectReplyContext({
  currentThread,
  emailAccount,
  emailProvider,
}: {
  currentThread: EmailForLLM[];
  emailAccount: EmailAccountWithAI;
  emailProvider: EmailProvider;
}): Promise<ReplyContextCollectorResult | null> {
  try {
    const sixMonthsAgo = subMonths(new Date(), 6);
    const subjectQuery = currentThread[0]?.subject?.trim();
    let subjectSearchFallback: string[] = [];

    const normalizedSubjectQuery = subjectQuery?.toLowerCase();
    const subjectTokens = normalizedSubjectQuery
      ? normalizedSubjectQuery
          .split(/\s+/)
          .map((token) => token.replace(/[^a-z0-9]/g, ""))
          .filter((token) => token.length >= 4)
      : [];
    if (normalizedSubjectQuery) {
      const { messages: subjectMessages } =
        await emailProvider.getMessagesWithPagination({
          query: subjectQuery,
          maxResults: 20,
          after: sixMonthsAgo,
        });

      subjectSearchFallback = subjectMessages
        .map((message) => {
          const subject = message.subject ?? "";
          const snippet = message.snippet ?? message.textPlain ?? "";
          return {
            subject,
            snippet,
            combined: `${subject}\n${snippet}`.trim(),
            subjectLower: subject.toLowerCase(),
            snippetLower: snippet.toLowerCase(),
          };
        })
        .filter((item) => {
          if (!normalizedSubjectQuery) return true;

          const directSubjectMatch = item.subjectLower.includes(
            normalizedSubjectQuery,
          );
          const directSnippetMatch = item.snippetLower.includes(
            normalizedSubjectQuery,
          );
          if (directSubjectMatch || directSnippetMatch) return true;

          if (subjectTokens.length === 0) return false;

          return subjectTokens.some(
            (token) =>
              item.subjectLower.includes(token) ||
              item.snippetLower.includes(token),
          );
        })
        .map((item) => item.combined);
    }

    const prompt = `Current email thread to analyze:

<thread>
${getEmailListPrompt({ messages: currentThread, messageMaxLength: 1000 })}
</thread>

${getUserInfoPrompt({ emailAccount })}

${getTodayForLLM()}`;

    const modelOptions = getModel("economy");

    const generateText = createGenerateText({
      emailAccount,
      label: "Reply context collector",
      modelOptions,
    });

    let finalResult: ReplyContextCollectorResult | null = null;

    await generateText({
      ...modelOptions,
      system: agentSystem,
      prompt,
      stopWhen: (result) =>
        result.steps.some((step) =>
          step.toolCalls?.some((call) => call.toolName === "finalizeResults"),
        ) || result.steps.length > 25,
      tools: {
        searchEmails: tool({
          description:
            "Search for emails in the user's history to find relevant context",
          inputSchema: z.object({
            query: z
              .string()
              .describe("Search query to find relevant emails in history"),
          }),
          execute: async ({ query }) => {
            logger.info("Searching emails", { query });
            try {
              const { messages } =
                await emailProvider.getMessagesWithPagination({
                  query,
                  maxResults: 20,
                  after: sixMonthsAgo,
                });

              const emails = messages.map((message) => {
                return getEmailForLLM(message, { maxLength: 2000 });
              });

              logger.info("Found emails", { emails: emails.length });
              // logger.trace("Found emails", { emails });

              return emails;
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";

              const err = error as Record<string, unknown>;
              const responseBody =
                typeof err?.body === "string" ? err.body : undefined;

              logger.error("Email search failed", {
                error,
                errorMessage,
                query,
                emailProvider: emailProvider.name,
                afterDate: sixMonthsAgo.toISOString(),
                responseBody,
                responseStatus: err?.statusCode,
              });
              return {
                success: false,
                error: errorMessage,
              };
            }
          },
        }),
        finalizeResults: tool({
          description:
            "Finalize and return your compiled results for downstream drafting",
          inputSchema: resultSchema,
          execute: async (resultPayload) => {
            logger.info("Finalizing results", {
              relevantEmails: resultPayload.relevantEmails.length,
            });
            logger.trace("Finalizing results", {
              notes: resultPayload.notes,
              relevantEmails: resultPayload.relevantEmails,
            });

            finalResult = resultPayload;

            return { success: true };
          },
        }),
      },
    });

    const parsedResult = resultSchema.safeParse(finalResult);
    const resolvedResult = parsedResult.success ? parsedResult.data : null;

    if (
      resolvedResult &&
      resolvedResult.relevantEmails.length === 0 &&
      subjectSearchFallback.length > 0
    ) {
      return {
        notes: resolvedResult.notes ?? null,
        relevantEmails: subjectSearchFallback,
      };
    }

    if (!resolvedResult && subjectSearchFallback.length > 0) {
      return { notes: null, relevantEmails: subjectSearchFallback };
    }

    return resolvedResult;
  } catch (error) {
    logger.error("Reply context collection failed", {
      email: emailAccount.email,
      error,
    });
    captureException(error, {
      extra: {
        scope: "reply-context-collector",
        email: emailAccount.email,
        userId: emailAccount.userId,
      },
    });
    return null;
  }
}
