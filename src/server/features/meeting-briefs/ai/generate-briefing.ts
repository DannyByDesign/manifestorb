import { z } from "zod";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import { getUserInfoPrompt } from "@/features/ai/helpers";
import type { CalendarEvent } from "@/features/calendar/event-types";
import type { MeetingBriefingData } from "@/features/meeting-briefs/gather-context";
import { stringifyEmailSimple } from "@/server/lib/stringify-email";
import { getEmailForLLM } from "@/server/lib/get-email-from-message";
import type { ParsedMessage } from "@/server/types";
import { formatDateTimeInUserTimezone } from "@/server/lib/date";
import {
  getCachedResearch,
  setCachedResearch,
} from "@/server/lib/redis/research-cache";
import type { Logger } from "@/server/lib/logger";

const MAX_EMAILS_PER_GUEST = 10;
const MAX_MEETINGS_PER_GUEST = 10;
const MAX_DESCRIPTION_LENGTH = 500;

const guestBriefingSchema = z.object({
  name: z.string().describe("The guest's name"),
  email: z.string().describe("The guest's email address"),
  bullets: z
    .array(z.string())
    .describe("Brief bullet points about this guest (max 10 words each)"),
});

const briefingSchema = z.object({
  guests: z
    .array(guestBriefingSchema)
    .describe("Briefing information for each meeting guest"),
});
export type BriefingContent = z.infer<typeof briefingSchema>;

const BRIEFING_SYSTEM_PROMPT = `You are an AI assistant that prepares concise meeting briefings.

Use the provided context (email history, past meetings, and any web research) to produce a structured briefing for each guest.

BRIEFING GUIDELINES:
- Keep it concise: <10 bullet points per guest, max 10 words per bullet
- Focus on what's helpful before the meeting: role, company, recent discussions, pending items
- Don't repeat meeting details (time, date, location) - the user already has those
- Keep bullets short: short phrases, no wrap-up lines or long paragraphs
- If a guest has no prior context and no research, note they are a new contact
- ONLY include information about the specific guests listed. Do NOT mention other attendees or colleagues.
- Note any uncertainty about identity (common names, conflicting info)`;

export async function aiGenerateMeetingBriefing({
  briefingData,
  emailAccount,
  logger,
}: {
  briefingData: MeetingBriefingData;
  emailAccount: EmailAccountWithAI;
  logger: Logger;
}): Promise<BriefingContent> {
  if (briefingData.externalGuests.length === 0) {
    return { guests: [] };
  }

  // 1. Optional web search per guest (direct, no agent)
  const guestResearch = await Promise.all(
    briefingData.externalGuests.map(async (guest) => {
      const cached = await getCachedResearch(
        emailAccount.userId,
        "websearch",
        guest.email,
        guest.name,
      );
      if (cached) {
        return { email: guest.email, name: guest.name, research: cached };
      }
      try {
        const domain = guest.email.includes("@")
          ? guest.email.split("@")[1]
          : "";
        const query = [guest.name, domain].filter(Boolean).join(" ");
        const modelOptions = getModel("economy");
        const searchTools = google.tools.googleSearch({});
        const searchResult = await generateText({
          model: modelOptions.model,
          prompt: `Find professional background and current role for: ${query}. Keep it brief.`,
          tools: { google_search: searchTools },
        });
        const text = searchResult.text ?? "";
        await setCachedResearch(
          emailAccount.userId,
          "websearch",
          guest.email,
          guest.name,
          text,
        ).catch((err) => logger.warn("Failed to cache research", { error: err }));
        return { email: guest.email, name: guest.name, research: text };
      } catch (error) {
        logger.warn("Web search failed for guest", {
          email: guest.email,
          error,
        });
        return {
          email: guest.email,
          name: guest.name,
          research: "Search failed.",
        };
      }
    }),
  );

  // 2. Build prompt with context + research
  const prompt = buildPrompt(briefingData, emailAccount, { includeToolInstructions: false });
  const researchContext = guestResearch
    .map((r) => `${r.name ?? r.email}: ${r.research}`)
    .join("\n\n");
  const fullPrompt = `${prompt}\n\n<web_research>\n${researchContext}\n</web_research>\n\nProduce the briefing for each guest using the context and web research above.`;

  // 3. Single generateObject call (no agent loop)
  const modelOptions = getModel();
  const generateObject = createGenerateObject({
    emailAccount,
    label: "Meeting Briefing",
    modelOptions,
  });

  try {
    const { object: briefing } = await generateObject({
      ...modelOptions,
      schema: briefingSchema,
      system: BRIEFING_SYSTEM_PROMPT,
      prompt: fullPrompt,
    });
    return briefing;
  } catch (error) {
    logger.warn("Meeting briefing generation failed, using fallback", {
      error,
    });
    return generateFallbackBriefing(briefingData.externalGuests);
  }
}

function generateFallbackBriefing(
  guests: { email: string; name?: string }[],
): BriefingContent {
  return {
    guests: guests.map((guest) => ({
      name: guest.name || guest.email.split("@")[0],
      email: guest.email,
      bullets: ["Research incomplete - meeting guest"],
    })),
  };
}

// Exported for testing
export function buildPrompt(
  briefingData: MeetingBriefingData,
  emailAccount: EmailAccountWithAI,
  options?: { includeToolInstructions?: boolean },
): string {
  const { event, externalGuests, emailThreads, pastMeetings } = briefingData;
  const includeToolInstructions = options?.includeToolInstructions ?? false;

  const allMessages = emailThreads.flatMap((t) => t.messages);

  const guestContexts: GuestContextForPrompt[] = externalGuests.map(
    (guest) => ({
      email: guest.email,
      name: guest.name,
      recentEmails: selectRecentEmailsForGuest(allMessages, guest.email),
      recentMeetings: selectRecentMeetingsForGuest(pastMeetings, guest.email),
      timezone: emailAccount.timezone,
    }),
  );

  const toolsNote = includeToolInstructions
    ? `\nAvailable search tools: webSearch`
    : "";
  const closingInstructions = includeToolInstructions
    ? `

For each guest listed above:
1. Review their email and meeting history provided
2. Use search tools to find their professional background
3. Once you have all information, call finalizeBriefing with the complete briefing`
    : "";

  const prompt = `Prepare a concise briefing for this upcoming meeting.

${getUserInfoPrompt({ emailAccount })}

<upcoming_meeting>
Title: ${event.title}
${event.description ? `Description: ${event.description}` : ""}
</upcoming_meeting>

<guest_context>
${guestContexts.map((guest) => formatGuestContext(guest)).join("\n")}
</guest_context>
${toolsNote}
${closingInstructions}`;

  return prompt;
}

type GuestContextForPrompt = {
  email: string;
  name?: string;
  recentEmails: ParsedMessage[];
  recentMeetings: CalendarEvent[];
  timezone: string | null;
};

function formatGuestContext(guest: GuestContextForPrompt): string {
  const hasEmails = guest.recentEmails.length > 0;
  const hasMeetings = guest.recentMeetings.length > 0;

  const guestHeader = `${guest.name ? `Name: ${guest.name}\n` : ""}Email: ${guest.email}`;

  if (!hasEmails && !hasMeetings) {
    return `<guest>
${guestHeader}

<no_prior_context>This appears to be a new contact with no prior email or meeting history. Use search tools to find information about them.</no_prior_context>
</guest>
`;
  }

  const sections: string[] = [];

  if (hasEmails) {
    sections.push(`<recent_emails>
${guest.recentEmails
        .map(
          (email) =>
            `<email>\n${stringifyEmailSimple(getEmailForLLM(email))}\n</email>`,
        )
        .join("\n")}
</recent_emails>`);
  }

  if (hasMeetings) {
    sections.push(`<recent_meetings>
${guest.recentMeetings.map((meeting) => formatMeetingForContext(meeting, guest.timezone)).join("\n")}
</recent_meetings>`);
  }

  return `<guest>
${guestHeader}

${sections.join("\n")}
</guest>
`;
}

function selectRecentMeetingsForGuest(
  pastMeetings: CalendarEvent[],
  guestEmail: string,
): CalendarEvent[] {
  const email = guestEmail.toLowerCase();

  return pastMeetings
    .filter((m) => m.attendees.some((a) => a.email.toLowerCase() === email))
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
    .slice(0, MAX_MEETINGS_PER_GUEST);
}

function selectRecentEmailsForGuest(
  messages: ParsedMessage[],
  guestEmail: string,
): ParsedMessage[] {
  const email = guestEmail.toLowerCase();

  return messages
    .filter((m) => messageIncludesEmail(m, email))
    .sort((a, b) => getMessageTimestampMs(b) - getMessageTimestampMs(a))
    .slice(0, MAX_EMAILS_PER_GUEST);
}

function messageIncludesEmail(
  message: ParsedMessage,
  emailLower: string,
): boolean {
  const headers = message.headers;
  return (
    headers.from.toLowerCase().includes(emailLower) ||
    headers.to.toLowerCase().includes(emailLower) ||
    (headers.cc?.toLowerCase().includes(emailLower) ?? false) ||
    (headers.bcc?.toLowerCase().includes(emailLower) ?? false)
  );
}

function getMessageTimestampMs(message: ParsedMessage): number {
  const internal = message.internalDate;
  if (internal && /^\d+$/.test(internal)) {
    const ms = Number(internal);
    return Number.isFinite(ms) ? ms : 0;
  }

  const parsed = Date.parse(message.date);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Exported for testing
export function formatMeetingForContext(
  meeting: CalendarEvent,
  timezone: string | null,
): string {
  const dateStr = formatDateTimeInUserTimezone(meeting.startTime, timezone);
  return `<meeting>
Title: ${meeting.title}
Date: ${dateStr}
${meeting.description ? `Description: ${meeting.description.slice(0, MAX_DESCRIPTION_LENGTH)}` : ""}
</meeting>
`;
}
