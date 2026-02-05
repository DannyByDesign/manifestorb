import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailSummary } from "@/features/reports/ai/summarize-emails";
import { createScopedLogger } from "@/server/lib/logger";
import { getModel } from "@/server/lib/llms/model";

const logger = createScopedLogger("ai/report/analyze-email-behavior");

const emailBehaviorSchema = z.object({
  timingPatterns: z.object({
    peakHours: z.array(z.string()).describe("Peak email activity hours"),
    responsePreference: z.string().describe("Preferred response timing"),
    frequency: z.string().describe("Overall email frequency"),
  }),
  contentPreferences: z.object({
    preferred: z
      .array(z.string())
      .describe("Types of emails user engages with"),
    avoided: z
      .array(z.string())
      .describe("Types of emails user typically ignores"),
  }),
  engagementTriggers: z
    .array(z.string())
    .describe("What prompts user to take action on emails"),
});

export async function aiAnalyzeEmailBehavior(
  emailSummaries: EmailSummary[],
  emailAccount: EmailAccountWithAI,
  sentEmailSummaries?: EmailSummary[],
): Promise<z.infer<typeof emailBehaviorSchema> | null> {
const system = `You are an expert AI system that analyzes a user's email behavior to infer timing patterns, content preferences, and engagement triggers.

Focus on identifying consistent patterns that can inform automation decisions.
Keep each output field short (short phrases, no wrap-up lines). Return JSON only (no markdown or extra keys).`;

  const prompt = `### Email Analysis Data

**Received Emails:**
${emailSummaries.map((email, i) => `${i + 1}. From: ${email.sender} | Subject: ${email.subject} | Category: ${email.category} | Summary: ${email.summary}`).join("\n")}

${
  sentEmailSummaries && sentEmailSummaries.length > 0
    ? `
**Sent Emails:**
${sentEmailSummaries.map((email, i) => `${i + 1}. To: ${email.sender} | Subject: ${email.subject} | Category: ${email.category} | Summary: ${email.summary}`).join("\n")}
`
    : ""
}

---

Analyze the email patterns and identify:
1. Timing patterns (when emails are most active, response preferences)
2. Content preferences (what types of emails they engage with vs avoid)
3. Engagement triggers (what prompts them to take action)`;

  const modelOptions = getModel("economy");

  const generateObject = createGenerateObject({
    emailAccount,
    label: "email-report-email-behavior",
    modelOptions,
  });

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: emailBehaviorSchema,
    });

    return result.object;
  } catch (error) {
    logger.error("Failed to analyze email behavior", { error });
    return null;
  }
}
