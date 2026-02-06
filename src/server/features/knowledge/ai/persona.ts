import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import { USER_ROLES } from "@/server/lib/constants/user-roles";
import { getEmailListPrompt } from "@/features/ai/helpers";

const logger = createScopedLogger("ai/knowledge/persona");

export const personaAnalysisSchema = z.object({
  persona: z
    .string()
    .describe(
      "The identified professional role (can be from the provided list or a custom role if evidence strongly suggests otherwise)",
    ),
  industry: z
    .string()
    .describe(
      "The specific industry or sector they work in (e.g., SaaS, Healthcare, E-commerce, Education, Finance, etc.)",
    ),
  positionLevel: z
    .enum(["entry", "mid", "senior", "executive"])
    .describe(
      "Their seniority level based on decision-making authority and responsibilities",
    ),
  responsibilities: z
    .array(z.string())
    .describe(
      "An array of 3-5 key responsibilities evident from their email patterns and communications",
    ),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe(
      "Your confidence level in this assessment based on the available evidence",
    ),
  reasoning: z
    .string()
    .describe(
      "Brief explanation of why this persona was chosen, citing specific evidence from the emails",
    ),
});

export type PersonaAnalysis = z.infer<typeof personaAnalysisSchema>;

export async function aiAnalyzePersona(options: {
  emails: EmailForLLM[];
  emailAccount: EmailAccountWithAI;
}): Promise<PersonaAnalysis | null> {
  const { emails, emailAccount } = options;

  if (!emails.length) {
    logger.warn("No emails provided for persona analysis");
    return null;
  }

  const rolesList = USER_ROLES.map(
    (role) => `- ${role.value}: ${role.description}`,
  ).join("\n");

  const system = `You are a persona analyst specializing in identifying professional roles and personas based on email communication patterns.

Analyze the user's emails to determine their most likely professional role or persona. Examine the content, context, recipients, and communication patterns to identify:

1. Their primary professional role or function
2. The industry or sector they likely work in
3. Their position level (entry, mid, senior, executive)
4. Key responsibilities evident from their communications

Consider these common personas as defaults, but feel free to suggest a more specific or different role if the evidence strongly points elsewhere:
${rolesList}

If the user doesn't clearly fit into one of these categories, provide a custom persona that better describes their role based on the email evidence.

If the user profile includes an "about" section, treat it as primary evidence and use it to resolve ambiguity.
If the "about" section names an industry or function (e.g., "HR"), set the industry to that value and do not replace it with a generic label like "SaaS".

Base your analysis on:
- Topics discussed in emails
- Types of recipients (clients, team members, vendors, etc.)
- Business terminology and jargon used
- Meeting types and purposes
- Projects or deals mentioned
- Decision-making authority evident
- Communication frequency and urgency

Return a JSON object with the analyzed persona information. JSON only, no markdown or extra keys.
Keep "responsibilities" to 3-5 short phrases and keep "reasoning" to 1-2 short sentences.`;

  const prompt = `The user's email address is: ${emailAccount.email}

This is important: You are analyzing the persona of ${emailAccount.email}. Look at what they write about, how they communicate, and who they interact with to determine their professional role.

${emailAccount.about ? `User about:\n${emailAccount.about}\n` : ""}

Here are the emails they've sent:
<emails>
${getEmailListPrompt({ messages: emails, messageMaxLength: 1000 })}
</emails>`;

  const modelOptions = getModel("economy");

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Persona Analysis",
    modelOptions,
  });

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: personaAnalysisSchema,
    });

    if (result.object) {
      const aboutLower = emailAccount.about?.toLowerCase() ?? "";
      const aboutOverridesIndustry =
        aboutLower.includes("human resources") || aboutLower.includes("hr");
      const normalizedIndustry =
        aboutOverridesIndustry ||
        result.object.industry?.toLowerCase().includes("human resources")
          ? "HR"
          : result.object.industry;

      if (emailAccount.about) {
        return {
          ...result.object,
          industry: normalizedIndustry,
          confidence: "high",
        };
      }

      return { ...result.object, industry: normalizedIndustry };
    }

    return result.object;
  } catch (error) {
    logger.error("Error analyzing persona", { error });
    return null;
  }
}
