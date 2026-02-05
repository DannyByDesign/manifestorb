import { z } from "zod";
import { isDefined } from "@/server/types";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { Category } from "@/generated/prisma/client";
import { formatCategoriesForPrompt } from "@/features/categorize/ai/format-categories";
import { extractEmailAddress } from "@/server/integrations/google";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import { createScopedLogger } from "@/server/lib/logger";
import { categorizeSenderHeuristic } from "@/features/categorize/ai/heuristics";

const logger = createScopedLogger("ai/categorize-sender");

export const REQUEST_MORE_INFORMATION_CATEGORY = "RequestMoreInformation";
export const UNKNOWN_CATEGORY = "Other";

const categorizeSendersSchema = z.object({
  senders: z.array(
    z.object({
      rationale: z.string().describe("Keep it short."),
      sender: z.string(),
      category: z.string(), // not using enum, because sometimes the ai creates new categories, which throws an error. we prefer to handle this ourselves
    }),
  ),
});

export async function aiCategorizeSenders({
  emailAccount,
  senders,
  categories,
}: {
  emailAccount: EmailAccountWithAI;
  senders: {
    emailAddress: string;
    emails: { subject: string; snippet: string }[];
  }[];
  categories: Pick<Category, "name" | "description">[];
}): Promise<
  {
    category?: string;
    sender: string;
  }[]
> {
  if (senders.length === 0) return [];

  const heuristicResults = senders.map((sender) => {
    if (sender.emails.length === 0) {
      return {
        sender: sender.emailAddress,
        category: REQUEST_MORE_INFORMATION_CATEGORY,
      };
    }

    return {
      sender: sender.emailAddress,
      category: categorizeSenderHeuristic({
        emailAccount,
        sender: sender.emailAddress,
        emails: sender.emails,
      }),
    };
  });

  const unresolvedSenders = senders.filter(
    (_, index) => !heuristicResults[index]?.category,
  );

  if (unresolvedSenders.length === 0) {
    return heuristicResults.map((result) => ({
      sender: result.sender,
      category: result.category ?? UNKNOWN_CATEGORY,
    }));
  }

  const system = `You are an AI assistant specializing in email management and organization.
Your task is to categorize email accounts based on their names, email addresses, and emails they've sent us.
Provide accurate categorizations to help users efficiently manage their inbox.`;

  const prompt = `Categorize the following senders:

  ${unresolvedSenders
    .map(
      ({ emailAddress, emails }) => `<sender>
  <email_address>${emailAddress}</email_address>
  ${
    emails.length
      ? `<recent_emails>
          ${emails
            .map(
              (s) => `
            <email>
              <subject>${s.subject}</subject>
              <snippet>${s.snippet}</snippet>
            </email>`,
            )
            .join("")}
          </recent_emails>`
      : "<recent_emails>No emails available</recent_emails>"
  }
</sender>`,
    )
    .join("\n")}

<categories>
${formatCategoriesForPrompt(categories)}
</categories>

<instructions>
1. Analyze each sender's email address and their recent emails for categorization.
2. If the sender's category is clear, assign it.
3. Use "${UNKNOWN_CATEGORY}" if the category is unclear or multiple categories could apply.
4. Use "${REQUEST_MORE_INFORMATION_CATEGORY}" if more context is needed.
</instructions>

<important>
- Accuracy is more important than completeness
- Only use the categories provided above, or "${UNKNOWN_CATEGORY}" or "${REQUEST_MORE_INFORMATION_CATEGORY}"
- Respond with "${UNKNOWN_CATEGORY}" if unsure
- Return JSON only (no markdown or extra keys)
</important>`;

  const modelOptions = getModel("economy");

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Categorize senders bulk",
    modelOptions,
  });

  try {
    const aiResponse = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: categorizeSendersSchema,
    });

    const matchedSenders = matchSendersWithFullEmail(
      aiResponse.object.senders,
      unresolvedSenders.map((s) => s.emailAddress),
    );

    const aiResults = matchedSenders.map((r) => {
      if (
        r.category !== UNKNOWN_CATEGORY &&
        r.category !== REQUEST_MORE_INFORMATION_CATEGORY &&
        !categories.find((c) => c.name === r.category)
      ) {
        return {
          category: undefined,
          sender: r.sender,
        };
      }

      return r;
    });

    return [
      ...heuristicResults.filter((result) => result.category),
      ...aiResults,
    ];
  } catch (error) {
    logger.error("Failed to categorize senders with AI", { error });
    return heuristicResults
      .filter((result) => result.category)
      .map((result) => ({
        sender: result.sender,
        category: result.category ?? UNKNOWN_CATEGORY,
      }));
  }
}

// match up emails with full email
// this is done so that the LLM can return less text in the response
// and also so that we can match sure the senders it's returning are part of the input (and it didn't hallucinate)
// NOTE: if there are two senders with the same email address (but different names), it will only return one of them
function matchSendersWithFullEmail(
  aiResponseSenders: z.infer<typeof categorizeSendersSchema>["senders"],
  originalSenders: string[],
) {
  const normalizedOriginalSenders: Record<string, string> = {};
  for (const sender of originalSenders) {
    normalizedOriginalSenders[sender] = extractEmailAddress(sender);
  }

  return aiResponseSenders
    .map((r) => {
      const normalizedResponseSender = extractEmailAddress(r.sender);
      const sender = originalSenders.find(
        (s) => normalizedOriginalSenders[s] === normalizedResponseSender,
      );

      if (!sender) return;

      return { sender, category: r.category };
    })
    .filter(isDefined);
}
