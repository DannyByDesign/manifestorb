/** biome-ignore-all lint/style/noMagicNumbers: we're defining constants */
import type { LanguageModelUsage } from "ai";
import { saveUsage } from "@/server/lib/redis/usage";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("usage");

export async function saveAiUsage({
  email,
  model,
  usage,
}: {
  email: string;
  provider: string;
  model: string;
  usage: LanguageModelUsage;
  label: string;
}) {
  const cost = calcuateCost(model, usage);

  try {
    return saveUsage({ email, cost, usage });
  } catch (error) {
    logger.error("Failed to save usage", { error });
  }
}

const gemini2_5flash = {
  input: 0.15 / 1_000_000,
  output: 0.6 / 1_000_000,
};
const gemini2_5pro = {
  input: 1.25 / 1_000_000,
  output: 10 / 1_000_000,
};

const gemini3_0flash = {
  input: 0.5 / 1_000_000,
  output: 3 / 1_000_000,
};

const gemini3_0pro = {
  input: 2 / 1_000_000,
  output: 12 / 1_000_000,
};

const costs: Record<
  string,
  {
    input: number;
    output: number;
  }
> = {
  // https://openai.com/pricing
  "gpt-3.5-turbo-0125": {
    input: 0.5 / 1_000_000,
    output: 1.5 / 1_000_000,
  },
  "gpt-4-turbo": {
    input: 10 / 1_000_000,
    output: 30 / 1_000_000,
  },
  "gpt-5-mini": {
    input: 0.25 / 1_000_000,
    output: 2 / 1_000_000,
  },
  "gpt-5.1": {
    input: 1.25 / 1_000_000,
    output: 10 / 1_000_000,
  },
  // https://ai.google.dev/pricing
  "gemini-1.5-pro-latest": {
    input: 1.25 / 1_000_000,
    output: 5 / 1_000_000,
  },
  "gemini-1.5-flash-latest": {
    input: 0.075 / 1_000_000,
    output: 0.3 / 1_000_000,
  },
  "gemini-2.0-flash-lite": {
    input: 0.075 / 1_000_000,
    output: 0.3 / 1_000_000,
  },
  "gemini-2.0-flash": gemini2_5flash,
  "gemini-2.5-flash": gemini2_5flash,
  "gemini-3-flash": gemini3_0flash,
  "gemini-3-flash-preview": gemini3_0flash,
  "gemini-3-pro": gemini3_0pro,
  "gemini-3-pro-preview": gemini3_0pro,
  "google/gemini-2.0-flash-001": gemini2_5flash,
  "google/gemini-2.5-flash-preview-05-20": gemini2_5flash,
  "google/gemini-2.5-pro-preview-03-25": gemini2_5pro,
  "google/gemini-2.5-pro-preview-06-05": gemini2_5pro,
  "google/gemini-2.5-pro-preview": gemini2_5pro,
  "google/gemini-2.5-pro": gemini2_5pro,
  "google/gemini-3-flash": gemini3_0flash,
  "google/gemini-3-flash-preview": gemini3_0flash,
  "google/gemini-3-pro": gemini3_0pro,
  "google/gemini-3-pro-preview": gemini3_0pro,
};

// returns cost in cents
function calcuateCost(model: string, usage: LanguageModelUsage): number {
  if (!costs[model]) return 0;

  const { input, output } = costs[model];

  return (usage.inputTokens ?? 0) * input + (usage.outputTokens ?? 0) * output;
}
