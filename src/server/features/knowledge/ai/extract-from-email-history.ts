import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import { getEmailListPrompt, getTodayForLLM } from "@/features/ai/helpers";
import { preprocessBooleanLike } from "@/server/lib/zod";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import { getUserInfoPrompt } from "@/features/ai/helpers";

const system = `You are an email history analysis agent. Your task is to analyze the provided historical email threads and extract relevant information that would be helpful for drafting a response to the current email thread.

Your task:
1. Analyze the historical email threads to understand relevant past context and interactions
2. Identify key points, commitments, questions, and unresolved items from previous conversations
3. Extract any relevant dates, deadlines, or time-sensitive information mentioned in past exchanges
4. Note any specific preferences or communication patterns shown in previous exchanges

Provide a concise summary (max 500 characters) that captures the most important historical context needed for drafting a response to the current thread. Focus on:
- Key unresolved points or questions from past exchanges
- Any commitments or promises made in previous conversations
- Important dates or deadlines established in past emails
- Notable preferences or patterns in communication

If no relevant historical context is found, set hasHistoricalContext to false and return an empty summary.
Return JSON only (no markdown or extra keys).`;

const getUserPrompt = ({
  currentThreadMessages,
  historicalMessages,
  emailAccount,
  todayString,
}: {
  currentThreadMessages: EmailForLLM[];
  historicalMessages: EmailForLLM[];
  emailAccount: EmailAccountWithAI;
  todayString: string;
}) => {
  return `<current_email_thread>
${getEmailListPrompt({ messages: currentThreadMessages, messageMaxLength: 10_000 })}
</current_email_thread>

${
  historicalMessages.length > 0
    ? `<historical_email_threads>
${getEmailListPrompt({ messages: historicalMessages, messageMaxLength: 10_000 })}
</historical_email_threads>`
    : "No historical email threads available."
}

${getUserInfoPrompt({ emailAccount })}

${todayString}
Analyze the historical email threads and extract any relevant information that would be helpful for drafting a response to the current email thread. Provide a concise summary of the key historical context.`;
};

const schema = z.object({
  hasHistoricalContext: z
    .preprocess(preprocessBooleanLike, z.boolean())
    .describe("Whether there is any relevant historical context found."),
  summary: z
    .string()
    .describe(
      "A concise summary of relevant historical context, including key points, commitments, deadlines, from past conversations.",
    ),
});

export async function aiExtractFromEmailHistory({
  currentThreadMessages,
  historicalMessages,
  emailAccount,
  logger,
}: {
  currentThreadMessages: EmailForLLM[];
  historicalMessages: EmailForLLM[];
  emailAccount: EmailAccountWithAI;
  logger: Logger;
}): Promise<string | null> {
  try {
    logger.info("Extracting information from email history", {
      currentThreadCount: currentThreadMessages.length,
      historicalCount: historicalMessages.length,
    });

    if (historicalMessages.length === 0) {
      return "No relevant historical context available.";
    }

    const todayString = getTodayForLLM();
    const prompt = getUserPrompt({
      currentThreadMessages,
      historicalMessages,
      emailAccount,
      todayString,
    });

    const modelOptions = getModel("economy");

    const generateObject = createGenerateObject({
      emailAccount,
      label: "Email history extraction",
      modelOptions,
    });

    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema,
    });

    return addWeekdayHints(result.object.summary, todayString);
  } catch (error) {
    logger.error("Failed to extract information from email history", { error });
    return null;
  }
}

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function addWeekdayHints(summary: string, todayString: string): string {
  const dateMatch = summary.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(st|nd|rd|th)?\b/i,
  );
  if (!dateMatch) return summary;

  const monthName = dateMatch[1].toLowerCase();
  const dayNumber = Number(dateMatch[2]);
  const monthIndex = MONTHS[monthName];
  if (monthIndex === undefined || Number.isNaN(dayNumber)) return summary;

  const isoMatch = todayString.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/,
  );
  const year = isoMatch ? new Date(isoMatch[0]).getUTCFullYear() : new Date().getUTCFullYear();
  const date = new Date(Date.UTC(year, monthIndex, dayNumber));

  if (Number.isNaN(date.getTime())) return summary;

  const weekday = date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });

  if (summary.toLowerCase().includes(weekday.toLowerCase())) return summary;

  return summary.replace(dateMatch[0], `${weekday} ${dateMatch[0]}`);
}
