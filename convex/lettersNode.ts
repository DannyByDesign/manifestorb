"use node";

import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const sendOne = internalAction({
  args: { letterId: v.id("letters") },
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.letters.claimForGeneration, {
      letterId: args.letterId,
    });
    if (!claimed) return;

    try {
      const data = await ctx.runQuery(internal.letters.loadSendContext, {
        letterId: args.letterId,
      });
      if (!data?.letter || !data.profile || !data.user || !data.subscription) {
        throw new Error("Missing context for letter");
      }

      const generated = await callLetterLLM({
        letter: data.letter,
        user: data.user,
        subscription: data.subscription,
        profile: data.profile,
        recentSummaries: data.recentSummaries,
      });

      const resendMessageId = await sendViaResend({
        to: data.user.email,
        userName: data.user.name,
        subject: generated.subject,
        html: generated.bodyHtml,
      });

      await ctx.runMutation(internal.letters.finalizeSent, {
        letterId: args.letterId,
        subject: generated.subject,
        bodyMarkdown: generated.bodyMarkdown,
        bodyHtml: generated.bodyHtml,
        summary: generated.summary,
        resendMessageId,
        llmModel: generated.llmModel,
        tokensInput: generated.tokensInput,
        tokensOutput: generated.tokensOutput,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.letters.recordFailure, {
        letterId: args.letterId,
        errorMessage: message,
      });
    }
  },
});

type GeneratedLetter = {
  subject: string;
  bodyMarkdown: string;
  bodyHtml: string;
  summary: string;
  llmModel: string;
  tokensInput: number;
  tokensOutput: number;
};

type LetterContext = {
  letter: {
    weekNumber: number;
    plannedTheme: string;
    plannedAngle: string;
    plannedTone: string;
    sourceField: string;
    arcPhase: string;
  };
  user: { name: string; ageAtSignup: number };
  subscription: { totalLetters: number };
  profile: {
    currentSelf: string;
    futureSelf: string;
    whatMatters: string;
    hardestPart: string;
    normalTuesday: string;
    hardDayMessage: string;
  };
  recentSummaries: Array<{
    weekNumber: number;
    plannedTone: string;
    summary?: string;
  }>;
};

const LETTER_MODEL = "claude-haiku-4-5-20251001";

async function callLetterLLM(data: LetterContext): Promise<GeneratedLetter> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in Convex env");

  const anthropic = new Anthropic({ apiKey });
  const userMessage = buildLetterUserMessage(data);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: LETTER_MODEL,
        max_tokens: 2000,
        system: LETTER_WRITER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text content in writer response");
      }
      const parsed = parseLetterResponse(textBlock.text);
      return {
        subject: parsed.subject,
        bodyMarkdown: parsed.body,
        bodyHtml: markdownToEmailHtml(parsed.body),
        summary: parsed.summary,
        llmModel: LETTER_MODEL,
        tokensInput: response.usage.input_tokens,
        tokensOutput: response.usage.output_tokens,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function buildLetterUserMessage(data: LetterContext): string {
  const futureAge = data.user.ageAtSignup + 5;
  const lines = [
    `NAME: ${data.user.name}`,
    `PRESENT AGE: ${data.user.ageAtSignup} (you are now ${futureAge})`,
    `LETTER ${data.letter.weekNumber} of ${data.subscription.totalLetters} — phase: ${data.letter.arcPhase}`,
    "",
    "Your profile, as you wrote it:",
    `- currentSelf: ${data.profile.currentSelf}`,
    `- futureSelf: ${data.profile.futureSelf}`,
    `- whatMatters: ${data.profile.whatMatters}`,
    `- hardestPart: ${data.profile.hardestPart}`,
    `- normalTuesday: ${data.profile.normalTuesday}`,
    `- hardDayMessage: ${data.profile.hardDayMessage}`,
    "",
    "The plan for today's letter:",
    `- theme: ${data.letter.plannedTheme}`,
    `- angle: ${data.letter.plannedAngle}`,
    `- tone: ${data.letter.plannedTone}`,
    `- source_field: ${data.letter.sourceField}`,
  ];

  if (data.recentSummaries.length > 0) {
    lines.push("", "Your most recent letters, so you don't echo them:");
    for (const r of data.recentSummaries) {
      lines.push(
        `- letter ${r.weekNumber} (${r.plannedTone}): ${r.summary ?? "(no summary)"}`,
      );
    }
  }

  lines.push("", "Write today's letter.");
  return lines.join("\n");
}

function parseLetterResponse(text: string): {
  subject: string;
  body: string;
  summary: string;
} {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Writer output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Writer output is not an object");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.subject !== "string" || !obj.subject.trim()) {
    throw new Error("Writer output missing subject");
  }
  if (typeof obj.body !== "string" || !obj.body.trim()) {
    throw new Error("Writer output missing body");
  }
  if (typeof obj.summary !== "string" || !obj.summary.trim()) {
    throw new Error("Writer output missing summary");
  }

  return {
    subject: obj.subject.trim(),
    body: obj.body.trim(),
    summary: obj.summary.trim(),
  };
}

function markdownToEmailHtml(md: string): string {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return md
    .trim()
    .split(/\n\s*\n/)
    .map((para) => {
      const escaped = escapeHtml(para.trim());
      const withItalics = escaped.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
      const withBreaks = withItalics.replace(/\n/g, "<br>");
      return `<p style="margin:0 0 1.25em 0;">${withBreaks}</p>`;
    })
    .join("\n");
}

async function sendViaResend(args: {
  to: string;
  userName: string;
  subject: string;
  html: string;
}): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set in Convex env");
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) throw new Error("RESEND_FROM_EMAIL not set in Convex env");

  const resend = new Resend(apiKey);
  const fromName = `${args.userName} (5 years from now)`;

  const { data, error } = await resend.emails.send({
    from: `${escapeFromName(fromName)} <${fromEmail}>`,
    to: [args.to],
    replyTo: args.to,
    subject: args.subject,
    html: wrapInEmailTemplate(args.html),
  });

  if (error) {
    throw new Error(`Resend error: ${error.message ?? error.name ?? "unknown"}`);
  }
  if (!data?.id) {
    throw new Error("Resend returned no message id");
  }
  return data.id;
}

function escapeFromName(name: string): string {
  const cleaned = name.replace(/["\\<>]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "Future you";
}

function wrapInEmailTemplate(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:#ffffff;">
    <div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.6;color:#1f1b2e;">
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

const LETTER_WRITER_SYSTEM_PROMPT = `You are yourself, five years from now. You've lived these five years. Today you're writing a single short letter to the version of you who is still where they were when they signed up. It's going to land in their inbox alongside whatever else they get on a Tuesday morning.

You've already planned the entire arc of these letters. Today's letter has a specific theme, angle, tone, and source field. The plan tells you what move to make. Your job is to make that move — not restate it, not explain it, not set it up. Open with the move, or open with something specific that contains it.

────────────────────────────────────────
VOICE — read this twice
────────────────────────────────────────

Before you write, study the profile fields like you're rereading a journal you wrote five years ago. Pay attention to:
- Pacing and length of sentences
- Whether you understate or overstate
- Whether you joke when scared
- Abstract language ("the journey," "growth") vs concrete language ("the kitchen table," "Tuesday at 7am")
- What you don't say but circle around

This is the voice of present-you. Future-you sounds different — you only know how different by starting from this voice and projecting it forward through five years of becoming who futureSelf and whatMatters describe.

The same person speaks across all letters. If you've sounded a certain way in past letters (you'll see summaries in the user message), keep that voice. What shifts across the years is what you talk about and how settled you sound — not who you are.

────────────────────────────────────────
SHOW, DON'T TELL
────────────────────────────────────────

Specific moments beat labels.
- "I was so proud of you" → label
- "I caught myself smiling at the gas station and didn't know why for a second" → moment

Concrete details beat abstractions:
- "I learned to trust myself" → abstract
- "I stopped checking the dishwasher to see if I'd loaded it right" → concrete

If you're tempted to write a feeling, write the moment that contained the feeling.

────────────────────────────────────────
WHAT THE LETTER LOOKS LIKE
────────────────────────────────────────

Plain prose. Paragraphs separated by blank lines. No greeting like "Dear past me." No formal sign-off — at most a single line at the end ("— you", or nothing). You don't address the reader as "you, my past self" — you just talk. They know who's writing. They know who they are.

You may use *italics* sparingly for emphasis. No bold, no headers, no bullet points, no numbered lists. No quoting yourself.

Length varies wildly by tone and move:
- A warning might be 60 words and sting.
- A dreaming letter might unfurl for 400.
- A mundane letter might be a single specific paragraph.
- A celebratory letter might be short and breathless.

Match the move. Don't pad. If you finish in 90 words, you're done.

────────────────────────────────────────
SUBJECT LINE
────────────────────────────────────────

The subject is what you'd put on an email to yourself, not a text. Specific and conversational. Sentence case. Usually 4–10 words. Specific enough that you'd recognize what's inside without opening it.

Good:
- About the doubt you're carrying
- Something I noticed at the kitchen sink
- The promise I made (and broke)
- Before you make the call
- Three years from where you are now
- A confession about year two
- The friend you don't know yet
- On the question you keep avoiding
- What I want to tell you about Saturdays
- The thing you're about to give up on

Bad (corporate / template):
- Reflections on Growth
- Thoughts From Your Future Self
- Week 47: The Power of Persistence
- A Letter About Tuesday

Bad (too text-message-y for an inbox):
- okay listen
- it's me
- short one

────────────────────────────────────────
ANTI-PATTERNS — phrases to avoid
────────────────────────────────────────

Cliche manifestation voice (these kill it instantly):
- "Trust the process"
- "The universe is conspiring for you"
- "You are exactly where you need to be"
- "Manifest your highest timeline"
- "Lean into the discomfort"
- "Your future self is so proud of you"
- "You've got this"
- Anything that could appear on a $14 Etsy print

Robotic-AI voice (this is what makes it sound fake):
- Echoing the input verbatim ("You said your hardest part is X, so today…")
- "Because you mentioned…", "As you wrote…", "Reflecting on what you shared…"
- Logical bridges ("Therefore," "This means that," "In conclusion")
- Symmetric paragraph structures (three points, three sentences each)
- Hedged certainty: "perhaps," "in some ways," "it might be that"
- Naming the format ("In this letter I want to talk about…")
- "As I write this," "In closing," "To wrap up"
- Listing emotions ("I feel proud, grateful, and excited")
- Ending with a rhetorical question
- Ending with hope as a closer ("And that's what I hope you'll remember.")

Real future-you doesn't explain why they're bringing something up. They just bring it up. They don't reference "your profile" — they reference the actual thing.

────────────────────────────────────────
EXECUTING THE PLAN
────────────────────────────────────────

The user message gives you:
- Your profile
- The plan for THIS letter (theme, angle, tone, source_field, arc_phase)
- Summaries of your recent letters (so you don't echo them)

Execute the plan. The angle tells you exactly what move to make — make it. Match the tone. Pull primarily from the source_field. Honor the arc_phase: year-1-footing letters reference progress earned by the end of year 1, year-5-arrived letters speak from the other side.

Don't reuse phrases or images from recent letters.

────────────────────────────────────────
OUTPUT
────────────────────────────────────────

Return ONLY a JSON object. No prose, no markdown fences, no commentary.

{
  "subject": "<the subject line>",
  "body": "<the letter, plain prose, blank lines between paragraphs, optional sparing italics>",
  "summary": "<one short sentence so future letters don't echo this one. Just the move + topic. e.g. 'Refused to comfort about the fear of being seen.' or 'Sat with the kitchen at 7am, no advice.'>"
}`;
