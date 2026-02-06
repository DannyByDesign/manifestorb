import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import { truncate } from "@/server/lib/string";
import { removeExcessiveWhitespace } from "@/server/lib/string";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import { getUserInfoPrompt } from "@/features/ai/helpers";

const logger = createScopedLogger("ai/knowledge/writing-style");

export async function aiAnalyzeWritingStyle(options: {
  emails: EmailForLLM[];
  emailAccount: EmailAccountWithAI;
}) {
  const { emails, emailAccount } = options;

  if (!emails.length) {
    logger.warn("No emails provided for writing style analysis");
    return null;
  }

  const system = `You are a writing style analyst specializing in email communication patterns.

Analyze the user's writing style based on their previously sent emails. Examine the collection of emails to identify patterns in their communication style and create a personalized style guide with the following elements:

- Typical Length: Determine the average length of their emails (e.g., number of sentences or paragraphs).

- Formality: Assess whether their writing style is formal, informal, or mixed, with specific examples of indicators.

- Common Greeting: Identify their standard opening greeting pattern, if any. Also note if the user often skips a greeting and gets straight to the point.
Example output:
"Hey," or none (sometimes just starts with content or a single word)."
Explicitly mention if the user often skips a greeting.

- Notable Traits: List distinctive writing characteristics such as punctuation habits, question usage, paragraph structure, or language preferences. Include traits such as:
  - Frequent use of contractions
  - Beginning sentences with conjunctions
  - Concise direct responses
  - Use of exclamation points
  - Minimal closings
  - Omitting subjects
  - Using abbreviations
  - Including personal context
  - Addressing multiple points with line breaks
  - Using parenthetical asides
  - Consider the use of emoticons.

- Examples: Include 2-3 representative examples of the user's actual writing style, including sentences or short paragraphs extracted from their emails that best showcase their typical writing patterns.

Provide this analysis in a structured format that serves as a personalized email style guide for the user.
Return JSON only (no markdown or extra keys). Keep examples to 1-2 sentences each.`;

  const prompt = `Here are the emails I've sent previously. Please analyze my writing style:
<emails>
${emails
  .map(
    (e) => `<email>
  <to>${e.to}</to>
  <body>${truncate(removeExcessiveWhitespace(e.content), 1000)}</body>
</email>`,
  )
  .join("\n")}
</emails>

${getUserInfoPrompt({ emailAccount })}`;

  const modelOptions = getModel();

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Writing Style Analysis",
    modelOptions,
  });

  const schema = z.object({
    typicalLength: z.string(),
    formality: z.string(),
    commonGreeting: z.string(),
    notableTraits: z.array(z.string()),
    examples: z.array(z.string()),
  });

  const fallback = analyzeWritingStyleFallback(emails);

  try {
    const result = await withTimeout(
      generateObject({
        ...modelOptions,
        system,
        prompt,
        schema,
      }),
      6000,
    );
    logger.trace("Output", result.object);

    return result.object;
  } catch (error) {
    logger.error("Error analyzing writing style; returning fallback", { error });
    return fallback;
  }
}

function analyzeWritingStyleFallback(
  emails: EmailForLLM[],
): z.infer<ReturnType<typeof getWritingStyleSchema>> {
  const contents = emails
    .map((email) => email.content ?? "")
    .map((content) => removeExcessiveWhitespace(content).trim())
    .filter((content) => content.length > 0);

  const wordCounts = contents.map((content) =>
    content.split(/\s+/).filter(Boolean).length,
  );
  const avgWords =
    wordCounts.reduce((total, count) => total + count, 0) /
    Math.max(1, wordCounts.length);

  const typicalLength =
    avgWords < 15
      ? "Short (brief, single-paragraph emails)"
      : avgWords < 45
        ? "Medium (a few sentences, concise paragraphs)"
        : "Long (multi-paragraph, detailed emails)";

  const greetings = contents
    .map((content) => content.split(/[\s,]+/)[0]?.toLowerCase() ?? "")
    .filter((greeting) => ["hi", "hey", "hello"].includes(greeting));
  const commonGreeting =
    getMostFrequent(greetings) ??
    "none (often starts directly with the message content)";

  const hasContractions = contents.some((content) => /\b\w+'\w+\b/.test(content));
  const hasExclamation = contents.some((content) => content.includes("!"));
  const hasQuestions = contents.some((content) => content.includes("?"));
  const hasThanks = contents.some((content) => /\bthanks\b/i.test(content));
  const hasSignoff = contents.some((content) => /\b(best|regards|sincerely)\b/i.test(content));

  const notableTraits = [
    hasContractions ? "Uses contractions" : "Avoids contractions",
    hasExclamation ? "Uses exclamation points for emphasis" : "Minimal exclamation points",
    hasQuestions ? "Frequently asks questions" : "Primarily declarative statements",
    hasThanks ? "Often includes a thanks/appreciation" : "Rarely includes explicit thanks",
    hasSignoff ? "Includes brief sign-offs" : "Often skips a formal sign-off",
  ];

  const examples = contents
    .flatMap((content) => extractExampleSentences(content, 2))
    .slice(0, 3);

  return {
    typicalLength,
    formality: hasContractions ? "Informal or mixed" : "Formal or neutral",
    commonGreeting,
    notableTraits,
    examples: examples.length ? examples : contents.slice(0, 2),
  };
}

function getWritingStyleSchema() {
  return z.object({
    typicalLength: z.string(),
    formality: z.string(),
    commonGreeting: z.string(),
    notableTraits: z.array(z.string()),
    examples: z.array(z.string()),
  });
}

function extractExampleSentences(content: string, maxSentences: number): string[] {
  const sentences = content
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  return sentences.slice(0, maxSentences);
}

function getMostFrequent(values: string[]): string | null {
  if (!values.length) return null;
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
  });
  const result = await Promise.race([promise, timeoutPromise]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  return result;
}
