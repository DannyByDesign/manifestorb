import type { LanguageModelV2 } from "@ai-sdk/provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { env } from "@/env";
import { Provider } from "@/server/lib/llms/config";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("llms/model");

export type ModelType = "default" | "economy" | "chat";

export type SelectModel = {
  provider: string;
  modelName: string;
  model: LanguageModelV2;
  providerOptions?: Record<string, any>;
  backupModel: LanguageModelV2 | null;
};

/**
 * Gets the appropriate model based on the task type.
 * All AI routing is handled by the system using Google Gemini 2.5 Flash.
 */
export function getModel(modelType: ModelType = "default"): SelectModel {
  const data = selectModelByType(modelType);

  logger.info("Using model", {
    modelType,
    provider: data.provider,
    model: data.modelName,
  });

  return data;
}

function selectModelByType(modelType: ModelType): SelectModel {
  switch (modelType) {
    case "economy":
      return selectEconomyModel();
    case "chat":
      return selectChatModel();
    default:
      return selectDefaultModel();
  }
}

function selectModel(
  aiProvider: string,
  aiModel: string,
): SelectModel {
  // All models use Google Gemini - system handles all AI routing
  const modelName = aiModel || env.DEFAULT_LLM_MODEL || "gemini-2.5-flash";
  
  return {
    provider: Provider.GOOGLE,
    modelName,
    model: createGoogleGenerativeAI({
      apiKey: env.GOOGLE_API_KEY,
    })(modelName),
    backupModel: getBackupModel(),
  };
}

/**
 * Selects the appropriate economy model for high-volume or context-heavy tasks.
 * Uses Google Gemini 2.5 Flash for cost-effective processing.
 *
 * Use cases:
 * - Processing large knowledge bases
 * - Analyzing email history
 * - Bulk processing emails
 * - Any task with large context windows where cost efficiency matters
 */
function selectEconomyModel(): SelectModel {
  const model = env.ECONOMY_LLM_MODEL || "gemini-2.5-flash";
  return selectModel(Provider.GOOGLE, model);
}

/**
 * Selects the appropriate chat model for fast conversational tasks.
 * Uses Google Gemini 2.5 Flash for fast responses.
 */
function selectChatModel(): SelectModel {
  const model = env.CHAT_LLM_MODEL || "gemini-2.5-flash";
  return selectModel(Provider.GOOGLE, model);
}

/**
 * Selects the default model for general tasks.
 * Uses Google Gemini 2.5 Flash.
 */
function selectDefaultModel(): SelectModel {
  const model = env.DEFAULT_LLM_MODEL || "gemini-2.5-flash";
  return selectModel(Provider.GOOGLE, model);
}

/**
 * Returns a backup model to use when the primary model fails.
 * Uses Google Gemini 2.5 Flash as the backup.
 */
function getBackupModel(): LanguageModelV2 | null {
  if (!env.GOOGLE_API_KEY) return null;

  return createGoogleGenerativeAI({
    apiKey: env.GOOGLE_API_KEY,
  })("gemini-2.5-flash");
}
