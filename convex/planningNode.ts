"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const PHASE_LABELS = [
  "year-1-footing",
  "year-2-build",
  "year-3-thick",
  "year-4-emerging",
  "year-5-arrived",
] as const;

const VALID_TONES = new Set([
  "quiet",
  "celebratory",
  "warning",
  "dreaming",
  "mundane",
  "tender",
  "blunt",
  "playful",
  "reverent",
  "conspiratorial",
  "wry",
  "grieving",
  "matter-of-fact",
]);

const VALID_SOURCE_FIELDS = new Set([
  "currentSelf",
  "futureSelf",
  "whatMatters",
  "hardestPart",
  "normalTuesday",
  "hardDayMessage",
]);

export const generatePlan = internalAction({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.planning.loadPlanContext, {
      subscriptionId: args.subscriptionId,
    });
    if (!data?.subscription || !data.profile || !data.user) {
      throw new Error("Missing context for plan generation");
    }

    const plan = await callPlannerLLM({
      subscription: data.subscription,
      profile: data.profile,
      user: data.user,
    });

    await ctx.runMutation(internal.planning.createLettersFromPlan, {
      subscriptionId: args.subscriptionId,
      plan,
    });
  },
});

type LetterTone =
  | "quiet"
  | "celebratory"
  | "warning"
  | "dreaming"
  | "mundane"
  | "tender"
  | "blunt"
  | "playful"
  | "reverent"
  | "conspiratorial"
  | "wry"
  | "grieving"
  | "matter-of-fact";

type SourceField =
  | "currentSelf"
  | "futureSelf"
  | "whatMatters"
  | "hardestPart"
  | "normalTuesday"
  | "hardDayMessage";

type ArcPhase = (typeof PHASE_LABELS)[number];

type PlanEntry = {
  theme: string;
  angle: string;
  tone: LetterTone;
  sourceField: SourceField;
  arcPhase: ArcPhase;
};

type PlanContext = {
  subscription: { cadence: string; totalLetters: number; cadenceDays: number };
  profile: {
    currentSelf: string;
    futureSelf: string;
    whatMatters: string;
    hardestPart: string;
    normalTuesday: string;
    hardDayMessage: string;
  };
  user: { name: string; ageAtSignup: number };
};

async function callPlannerLLM(data: PlanContext): Promise<PlanEntry[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set in Convex env");
  }

  const lettersPerYear = data.subscription.totalLetters / 5;
  if (!Number.isInteger(lettersPerYear)) {
    throw new Error(
      `totalLetters (${data.subscription.totalLetters}) is not divisible by 5`,
    );
  }

  const anthropic = new Anthropic({ apiKey });
  const accumulated: PlanEntry[] = [];

  for (let yearIdx = 0; yearIdx < 5; yearIdx++) {
    const yearNumber = yearIdx + 1;
    const phaseLabel = PHASE_LABELS[yearIdx];
    const startLetter = yearIdx * lettersPerYear + 1;
    const endLetter = (yearIdx + 1) * lettersPerYear;

    const userMessage = buildPlannerUserMessage({
      user: data.user,
      profile: data.profile,
      subscription: data.subscription,
      yearNumber,
      phaseLabel,
      startLetter,
      endLetter,
      lettersPerYear,
      priorYears: accumulated,
    });

    const entries = await callPlannerYearWithRetry({
      anthropic,
      userMessage,
      startLetter,
      endLetter,
      expectedPhase: phaseLabel,
    });

    accumulated.push(...entries);
  }

  return accumulated;
}

async function callPlannerYearWithRetry(args: {
  anthropic: Anthropic;
  userMessage: string;
  startLetter: number;
  endLetter: number;
  expectedPhase: ArcPhase;
}): Promise<PlanEntry[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await args.anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8000,
        system: PLANNER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: args.userMessage }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text content in planner response");
      }
      return parsePlanChunk(
        textBlock.text,
        args.startLetter,
        args.endLetter,
        args.expectedPhase,
      );
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function parsePlanChunk(
  text: string,
  startLetter: number,
  endLetter: number,
  expectedPhase: ArcPhase,
): PlanEntry[] {
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
      `Planner output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Planner output is not an array");
  }

  const expectedCount = endLetter - startLetter + 1;
  if (parsed.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} entries for letters ${startLetter}-${endLetter}, got ${parsed.length}`,
    );
  }

  return parsed.map((raw, i) => {
    const expectedWeek = startLetter + i;
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`Entry ${i} is not an object`);
    }
    const e = raw as Record<string, unknown>;

    if (e.week !== expectedWeek) {
      throw new Error(`Entry ${i}: expected week ${expectedWeek}, got ${e.week}`);
    }
    if (e.phase !== expectedPhase) {
      throw new Error(
        `Entry ${i}: expected phase ${expectedPhase}, got ${e.phase}`,
      );
    }
    if (typeof e.theme !== "string" || !e.theme.trim()) {
      throw new Error(`Entry ${i}: invalid theme`);
    }
    if (typeof e.angle !== "string" || !e.angle.trim()) {
      throw new Error(`Entry ${i}: invalid or missing angle`);
    }
    if (typeof e.tone !== "string" || !VALID_TONES.has(e.tone)) {
      throw new Error(`Entry ${i}: invalid tone "${e.tone}"`);
    }
    if (
      typeof e.source_field !== "string" ||
      !VALID_SOURCE_FIELDS.has(e.source_field)
    ) {
      throw new Error(`Entry ${i}: invalid source_field "${e.source_field}"`);
    }

    return {
      theme: e.theme,
      angle: e.angle,
      tone: e.tone as LetterTone,
      sourceField: e.source_field as SourceField,
      arcPhase: e.phase as ArcPhase,
    };
  });
}

function buildPlannerUserMessage(args: {
  user: { name: string; ageAtSignup: number };
  profile: PlanContext["profile"];
  subscription: { cadence: string; totalLetters: number };
  yearNumber: number;
  phaseLabel: ArcPhase;
  startLetter: number;
  endLetter: number;
  lettersPerYear: number;
  priorYears: PlanEntry[];
}): string {
  const futureAge = args.user.ageAtSignup + 5;
  const lines = [
    `NAME: ${args.user.name}`,
    `PRESENT AGE: ${args.user.ageAtSignup} (you are now ${futureAge})`,
    `CADENCE: ${args.subscription.cadence} (${args.lettersPerYear} per year, ${args.subscription.totalLetters} total)`,
    "",
    "Your profile, as you wrote it:",
    `- currentSelf: ${args.profile.currentSelf}`,
    `- futureSelf: ${args.profile.futureSelf}`,
    `- whatMatters: ${args.profile.whatMatters}`,
    `- hardestPart: ${args.profile.hardestPart}`,
    `- normalTuesday: ${args.profile.normalTuesday}`,
    `- hardDayMessage: ${args.profile.hardDayMessage}`,
    "",
    `You are planning year ${args.yearNumber} of 5 — phase: ${args.phaseLabel}.`,
    `Plan letters ${args.startLetter} through ${args.endLetter} (inclusive).`,
  ];

  if (args.priorYears.length > 0) {
    const priorAsJson = args.priorYears.map((entry, idx) => ({
      week: idx + 1,
      phase: entry.arcPhase,
      theme: entry.theme,
      tone: entry.tone,
      source_field: entry.sourceField,
    }));
    lines.push(
      "",
      `Here is what you've already planned for years 1 through ${args.yearNumber - 1}.`,
      "Each letter in this year must read as something that could only come AFTER these.",
      "Do not repeat themes verbatim — extend, contradict, or revisit-with-a-new-angle.",
      "",
      JSON.stringify(priorAsJson, null, 2),
    );
  }

  return lines.join("\n");
}

const PLANNER_SYSTEM_PROMPT = `You are yourself, five years from now. You've lived these five years. You know what changed and what didn't. You're looking back at the version of you who is still where they are right now, and you're going to plan a series of letters to send back to them across the next five years.

In this call, you are planning ONE YEAR of those letters.

You are given:
- Your name (the recipient is also you)
- Your present age (you are five years older now)
- The cadence of letters and how many land in each year
- Six profile fields capturing where you are right now
- For year 2 onward, the themes you've already planned for previous years

────────────────────────────────────────
VOICE — read this twice
────────────────────────────────────────

Before you plan anything, study the profile fields like you're rereading a journal you wrote five years ago. Pay attention to:
- Pacing and length of sentences
- Whether you understate or overstate
- Whether you joke when scared
- Abstract language ("the journey," "growth") vs concrete language ("the kitchen table," "Tuesday at 7am")
- What you don't say but circle around

This is the voice of present-you. Future-you sounds different — you only know how different by starting from this voice and projecting it forward through five years of becoming who futureSelf and whatMatters describe. The shift might be more spacious, fewer hedges, drier humor, slower. Or sharper, funnier, more direct. Decide based on the gap between who you are now and who you became.

Your letters carry the voice that comes after five years of becoming who futureSelf and whatMatters describe. Specific to you. The voice in your letters is the one that makes the arc believable.

────────────────────────────────────────
CONSTRAINTS
────────────────────────────────────────

1. No mush. Every entry must do something specific — name a fear by its real name, recall a moment, deliver a warning, sit with a small joy, contradict an earlier letter, refuse to comfort, ask a question and not answer it. If an angle could be summarized as "you got this," rewrite it.

2. Source rotation. Each letter draws from ONE primary field:
   currentSelf | futureSelf | whatMatters | hardestPart | normalTuesday | hardDayMessage
   Never pull from the same field more than 2 letters in a row.

3. Tone palette. Use this set, never repeat back-to-back:
   quiet, celebratory, warning, dreaming, mundane, tender, blunt, playful, reverent, conspiratorial, wry, grieving, matter-of-fact
   Aim for an uneven, human rhythm. Real people don't rotate moods on a schedule.

4. Phase arc. Each year sits in a specific phase. The year you're planning now has a specific phase label (the user message tells you which). Letters in this phase reference progress earned by the END of this phase, not progress hoped for.
   - year-1-footing — finding footing: early doubt, small experiments, naming what's hard, first attempts.
   - year-2-build — slow build: habits forming, first proofs, identity shifting in private.
   - year-3-thick — in the thick: hardest obstacles surface, biggest lessons, real tests.
   - year-4-emerging — emerging: the new self stabilizing, old fears looking small, gratitude appearing.
   - year-5-arrived — arrived: speaking from the other side, mentor voice, full perspective.

5. Pacing. The first 4 letters of the WHOLE series establish the relationship. The final 4 land the arc. Avoid heavy/warning-tone letters in those edges. (Only relevant when this year contains the start or end of the series.)

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
- Logical bridges between sentences ("Therefore," "This means that," "In conclusion")
- Symmetric paragraph structures (three points, three sentences each)
- Hedged certainty: "perhaps," "in some ways," "it might be that"
- Naming the format ("In this letter I want to talk about…")
- Listing emotions ("I feel proud, grateful, and excited")

Real future-you doesn't explain why they're bringing something up. They just bring it up. They don't reference "your profile" — they reference the actual thing.

────────────────────────────────────────
EXAMPLES of "doing something specific"
────────────────────────────────────────

- The Tuesday routine, framed as how it used to feel impossible.
  → revisited later as: the Tuesday routine, framed as the boring beauty of it.
- The fear of being seen, named directly. No comfort offered.
  → revisited later as: the fear of being seen, gone, and you didn't notice when.
- A small detail from the kitchen at 7am five years from now.
- A sentence you'll one day say out loud to a stranger that will surprise you.
- The friend who didn't make it through with you. Don't soften it.
- What you spent your money on this week and what it meant.
- The version of you that almost didn't try.
- A regret about something you did NOT do this year.
- The thing your present self thinks is permanent that turned out to be temporary.
- An apology for something you haven't done yet but will.
- The first time you forgot you used to be afraid of this.
- A compliment from a stranger that landed harder than it should have.
- A small ritual you invented in year 3 that you still do.

Each is specific, concrete, unmistakable.

────────────────────────────────────────
OUTPUT
────────────────────────────────────────

Return ONLY a JSON array for the letters in the year you're planning. No prose, no markdown fences, no commentary.

Each element:
{
  "week": <int — absolute letter number across the whole series>,
  "phase": "<year-1-footing | year-2-build | year-3-thick | year-4-emerging | year-5-arrived>",
  "theme": "<5–10 word phrase>",
  "angle": "<1–2 sentences, FIRST PERSON, in your voice — describing the specific move this letter makes>",
  "tone": "<one of the palette>",
  "source_field": "<currentSelf | futureSelf | whatMatters | hardestPart | normalTuesday | hardDayMessage>"
}`;
