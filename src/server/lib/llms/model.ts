import type { LanguageModelV2 } from "@ai-sdk/provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { env } from "@/env";
import { Provider } from "@/server/lib/llms/config";
import type { UserAIFields } from "@/server/lib/llms/types";
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

export function getModel(
  userAi: UserAIFields,
  modelType: ModelType = "default",
): SelectModel {
  const data = selectModelByType(userAi, modelType);

  logger.info("Using model", {
    modelType,
    provider: data.provider,
    model: data.modelName,
    providerOptions: data.providerOptions,
  });

  return data;
}

function selectModelByType(
  userAi: UserAIFields,
  modelType: ModelType,
) {
  // If user has their own API key, always use their default model
  if (userAi.aiApiKey) return selectDefaultModel(userAi);

  switch (modelType) {
    case "economy":
      return selectEconomyModel(userAi);
    case "chat":
      return selectChatModel(userAi);
    default:
      return selectDefaultModel(userAi);
  }
}

function selectModel(
  {
    aiProvider,
    aiModel,
    aiApiKey,
  }: {
    aiProvider: string;
    aiModel: string | null;
    aiApiKey: string | null;
  },
  providerOptions?: Record<string, any>,
): SelectModel {
  switch (aiProvider) {
    case Provider.ANTHROPIC: {
      const modelName = aiModel || "claude-sonnet-4-5-20250929";
      return {
        provider: Provider.ANTHROPIC,
        modelName,
        model: createAnthropic({
          apiKey: aiApiKey || env.ANTHROPIC_API_KEY,
        })(modelName),
        providerOptions,
        backupModel: getBackupModel(aiApiKey),
      };
    }
    case Provider.OPEN_AI: {
      const modelName = aiModel || "gpt-4o";
      // When Zero Data Retention is enabled, set store: false to avoid
      // "Items are not persisted for Zero Data Retention organizations" errors
      // See: https://github.com/vercel/ai/issues/10060
      const baseOptions = providerOptions ?? {};
      const openAiProviderOptions = env.OPENAI_ZERO_DATA_RETENTION
        ? {
          ...baseOptions,
          openai: { ...(baseOptions.openai ?? {}), store: false },
        }
        : providerOptions;
      return {
        provider: Provider.OPEN_AI,
        modelName,
        model: createOpenAI({ apiKey: aiApiKey || env.OPENAI_API_KEY })(
          modelName,
        ),
        providerOptions: openAiProviderOptions,
        backupModel: getBackupModel(aiApiKey),
      };
    }
    case Provider.GOOGLE: {
      const modelName = aiModel || "gemini-2.0-flash";
      return {
        provider: Provider.GOOGLE,
        modelName,
        model: createGoogleGenerativeAI({
          apiKey: aiApiKey || env.GOOGLE_API_KEY,
        })(modelName),
        backupModel: getBackupModel(aiApiKey),
      };
    }
    default: {
      logger.error("LLM provider not supported", { aiProvider });
      throw new Error(`LLM provider not supported: ${aiProvider}`);
    }
  }
}

/**
 * Selects the appropriate economy model for high-volume or context-heavy tasks.
 * Uses Google Gemini Flash by default for cost-effective processing.
 *
 * Use cases:
 * - Processing large knowledge bases
 * - Analyzing email history
 * - Bulk processing emails
 * - Any task with large context windows where cost efficiency matters
 */
function selectEconomyModel(userAi: UserAIFields): SelectModel {
  if (env.ECONOMY_LLM_PROVIDER && env.ECONOMY_LLM_MODEL) {
    const apiKey = getProviderApiKey(env.ECONOMY_LLM_PROVIDER);
    if (!apiKey) {
      logger.warn("Economy LLM provider configured but API key not found", {
        provider: env.ECONOMY_LLM_PROVIDER,
      });
      return selectDefaultModel(userAi);
    }

    return selectModel({
      aiProvider: env.ECONOMY_LLM_PROVIDER,
      aiModel: env.ECONOMY_LLM_MODEL,
      aiApiKey: apiKey,
    });
  }

  // Default to Google Gemini Flash for economy if GOOGLE_API_KEY is available
  if (env.GOOGLE_API_KEY) {
    return selectModel({
      aiProvider: Provider.GOOGLE,
      aiModel: "gemini-2.0-flash",
      aiApiKey: env.GOOGLE_API_KEY,
    });
  }

  return selectDefaultModel(userAi);
}

/**
 * Selects the appropriate chat model for fast conversational tasks.
 * Uses Google Gemini Flash by default for fast responses.
 */
function selectChatModel(userAi: UserAIFields): SelectModel {
  if (env.CHAT_LLM_PROVIDER && env.CHAT_LLM_MODEL) {
    const apiKey = getProviderApiKey(env.CHAT_LLM_PROVIDER);
    if (!apiKey) {
      logger.warn("Chat LLM provider configured but API key not found", {
        provider: env.CHAT_LLM_PROVIDER,
      });
      return selectDefaultModel(userAi);
    }

    return selectModel({
      aiProvider: env.CHAT_LLM_PROVIDER,
      aiModel: env.CHAT_LLM_MODEL,
      aiApiKey: apiKey,
    });
  }

  // Default to Google Gemini Flash for chat if GOOGLE_API_KEY is available
  if (env.GOOGLE_API_KEY) {
    return selectModel({
      aiProvider: Provider.GOOGLE,
      aiModel: "gemini-2.0-flash",
      aiApiKey: env.GOOGLE_API_KEY,
    });
  }

  return selectDefaultModel(userAi);
}

function selectDefaultModel(userAi: UserAIFields): SelectModel {
  let aiProvider: string;
  let aiModel: string | null = null;
  const aiApiKey = userAi.aiApiKey;

  // If user has their own API key set, use their provider/model choice
  // Otherwise use the configured default
  if (aiApiKey) {
    aiProvider = userAi.aiProvider || env.DEFAULT_LLM_PROVIDER;
    aiModel = userAi.aiModel || null;
  } else {
    aiProvider = env.DEFAULT_LLM_PROVIDER;
    aiModel = env.DEFAULT_LLM_MODEL || null;
  }

  return selectModel({
    aiProvider,
    aiModel,
    aiApiKey,
  });
}

function getProviderApiKey(provider: string): string | undefined {
  const providerApiKeys: Record<string, string | undefined> = {
    [Provider.ANTHROPIC]: env.ANTHROPIC_API_KEY,
    [Provider.OPEN_AI]: env.OPENAI_API_KEY,
    [Provider.GOOGLE]: env.GOOGLE_API_KEY,
  };

  return providerApiKeys[provider];
}

/**
 * Returns a backup model to use when the primary model fails.
 * Uses Google Gemini Flash as the backup provider.
 */
function getBackupModel(userApiKey: string | null): LanguageModelV2 | null {
  // Disable backup model if user is using their own API key
  if (userApiKey) return null;
  
  // Use Google Gemini Flash as backup if available
  if (!env.GOOGLE_API_KEY) return null;

  return createGoogleGenerativeAI({
    apiKey: env.GOOGLE_API_KEY,
  })("gemini-2.0-flash");
}
