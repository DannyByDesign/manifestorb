import {
  APICallError,
  type ModelMessage,
  type Tool,
  type JSONValue,
  generateObject,
  generateText,
  RetryError,
  streamText,
  smoothStream,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type StreamTextOnStepFinishCallback,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";
import { jsonrepair } from "jsonrepair";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { ZodTypeAny } from "zod";
import { saveAiUsage } from "@/server/lib/usage";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import {
  addUserErrorMessageWithNotification,
  ErrorType,
} from "@/server/lib/error-messages";
import {
  captureException,
  isAWSThrottlingError,
  isIncorrectOpenAIAPIKeyError,
  isInvalidAIModelError,
  isOpenAIAPIKeyDeactivatedError,
  isAiQuotaExceededError,
  isServiceUnavailableError,
  SafeError,
} from "@/server/lib/error";
import { getModel, type ModelType } from "@/server/lib/llms/model";
import { createScopedLogger } from "@/server/lib/logger";
import { withNetworkRetry, withLLMRetry } from "./retry";
import { assertProviderFacingSchemaSafety } from "@/server/lib/llms/schema-safety";

const logger = createScopedLogger("llms");

const MAX_LOG_LENGTH = 200;
const SCHEMA_GUARD_LABEL_PATTERNS: RegExp[] = [
  /^orchestration-preflight$/u,
  /^Skills semantic parser$/u,
  /^Skills router \(baseline closed set\)$/u,
  /^Skills slot extraction/u,
  /^Capability planner/u,
];

const commonOptions: {
  experimental_telemetry: { isEnabled: boolean };
  headers?: Record<string, string>;
  providerOptions?: Record<string, Record<string, JSONValue>>;
} = { experimental_telemetry: { isEnabled: true } };

function shouldValidateProviderSchema(label: string): boolean {
  return SCHEMA_GUARD_LABEL_PATTERNS.some((pattern) => pattern.test(label));
}

export function createGenerateText({
  emailAccount,
  label,
  modelOptions,
}: {
  emailAccount: Pick<EmailAccountWithAI, "email" | "id" | "userId">;
  label: string;
  modelOptions: ReturnType<typeof getModel>;
}): typeof generateText {
  return async (...args) => {
    const [options, ...restArgs] = args;

    const generate = async (model: LanguageModelV2) => {
      logger.trace("Generating text", {
        label,
        system: options.system?.slice(0, MAX_LOG_LENGTH),
        prompt: options.prompt?.slice(0, MAX_LOG_LENGTH),
      });

      // AI SDK defaults to stopWhen: stepCountIs(1); pass stopWhen so the agent can run multiple tool-call steps and produce a final reply.
      const maxSteps = (options as { maxSteps?: number }).maxSteps ?? 20;
      const agentOptions =
        options.tools && maxSteps > 1
          ? { ...options, stopWhen: stepCountIs(maxSteps) }
          : options;

      const result = await generateText(
        {
          ...agentOptions,
          ...commonOptions,
          model,
        },
        ...restArgs,
      );

      if (result.usage) {
        await saveAiUsage({
          email: emailAccount.email,
          usage: result.usage,
          provider: modelOptions.provider,
          model: modelOptions.modelName,
          label,
        });
      }

      if (options.tools) {
        const toolCallInput = result.toolCalls?.[0]?.input;
        logger.trace("Result", {
          label,
          result: toolCallInput,
        });
      }

      return result;
    };

    try {
      return await withLLMRetry(
        () => withNetworkRetry(() => generate(modelOptions.model), { label }),
        { label },
      );
    } catch (error) {
      // Try backup model for service unavailable or throttling errors
      if (
        modelOptions.backupModel &&
        (isServiceUnavailableError(error) || isAWSThrottlingError(error))
      ) {
        logger.warn("Using backup model", {
          error,
          model: modelOptions.backupModel,
        });

        try {
          return await withLLMRetry(
            () =>
              withNetworkRetry(() => generate(modelOptions.backupModel!), {
                label,
              }),
            { label },
          );
        } catch (backupError) {
          await handleError(
            backupError,
            emailAccount.userId,
            emailAccount.email,
            emailAccount.id,
            label,
            modelOptions.modelName,
          );
          throw backupError;
        }
      }

      await handleError(
        error,
        emailAccount.userId,
        emailAccount.email,
        emailAccount.id,
        label,
        modelOptions.modelName,
      );
      throw error;
    }
  };
}

export function createGenerateObject({
  emailAccount,
  label,
  modelOptions,
}: {
  emailAccount: Pick<EmailAccountWithAI, "email" | "id" | "userId">;
  label: string;
  modelOptions: ReturnType<typeof getModel>;
}): typeof generateObject {
  return async (...args) => {
    const [options, ...restArgs] = args;

    const generate = async () => {
      logger.trace("Generating object", {
        label,
        system: options.system?.slice(0, MAX_LOG_LENGTH),
        prompt: options.prompt?.slice(0, MAX_LOG_LENGTH),
      });

      if (shouldValidateProviderSchema(label)) {
        const candidateSchema = (options as { schema?: ZodTypeAny }).schema;
        if (candidateSchema) {
          assertProviderFacingSchemaSafety({
            schema: candidateSchema,
            label,
          });
        }
      }

      if (
        !options.system?.includes("JSON") &&
        typeof options.prompt === "string" &&
        !options.prompt?.includes("JSON")
      ) {
        logger.warn("Missing JSON in prompt", { label });
      }

      const result = await generateObject(
        {
          experimental_repairText: async ({ text }) => {
            logger.info("Repairing text", { label });
            const fixed = jsonrepair(text);
            return fixed;
          },
          ...options,
          ...commonOptions,
          model: modelOptions.model,
        },
        ...restArgs,
      );

      if (result.usage) {
        await saveAiUsage({
          email: emailAccount.email,
          usage: result.usage,
          provider: modelOptions.provider,
          model: modelOptions.modelName,
          label,
        });
      }

      logger.trace("Generated object", {
        label,
        result: result.object,
      });

      return result;
    };

    try {
      return await withLLMRetry(
        () =>
          withNetworkRetry(generate, {
            label,
            shouldRetry: (error) =>
              NoObjectGeneratedError.isInstance(error) ||
              TypeValidationError.isInstance(error),
          }),
        { label },
      );
    } catch (error) {
      await handleError(
        error,
        emailAccount.userId,
        emailAccount.email,
        emailAccount.id,
        label,
        modelOptions.modelName,
      );
      throw error;
    }
  };
}

export async function chatCompletionStream({
  modelType,
  messages,
  tools,
  maxSteps,
  userEmail,
  usageLabel: label,
  onFinish,
  onStepFinish,
}: {
  modelType?: ModelType;
  messages: ModelMessage[];
  tools?: Record<string, Tool>;
  maxSteps?: number;
  userEmail: string;
  usageLabel: string;
  onFinish?: StreamTextOnFinishCallback<Record<string, Tool>>;
  onStepFinish?: StreamTextOnStepFinishCallback<Record<string, Tool>>;
}) {
  const { provider, model, modelName, providerOptions } = getModel(modelType);

  const result = streamText({
    model,
    messages,
    tools,
    stopWhen: maxSteps ? stepCountIs(maxSteps) : undefined,
    providerOptions,
    ...commonOptions,
    experimental_transform: smoothStream({ chunking: "word" }),
    onStepFinish,
    onFinish: async (result) => {
      const usagePromise = saveAiUsage({
        email: userEmail,
        provider,
        model: modelName,
        usage: result.usage,
        label,
      });

      const finishPromise = onFinish?.(result);

      try {
        await Promise.all([usagePromise, finishPromise]);
      } catch (error) {
        logger.error("Error in onFinish callback", {
          label,
          userEmail,
          error,
        });
        logger.trace("Result", { result });
        captureException(error, {
          userEmail,
          extra: { label },
        });
      }
    },
    onError: (error) => {
      logger.error("Error in chat completion stream", {
        label,
        userEmail,
        error,
      });
      captureException(error, {
        userEmail,
        extra: { label },
      });
    },
  });

  return result;
}

async function handleError(
  error: unknown,
  userId: string,
  userEmail: string,
  emailAccountId: string,
  label: string,
  modelName: string,
) {
  logger.error("Error in LLM call", {
    error,
    userId,
    userEmail,
    emailAccountId,
    label,
    modelName,
  });

  if (RetryError.isInstance(error) && isAiQuotaExceededError(error)) {
    return await addUserErrorMessageWithNotification({
      userId,
      userEmail,
      emailAccountId,
      errorType: ErrorType.AI_QUOTA_ERROR,
      errorMessage:
        "Your AI provider has rejected requests due to rate limits or quota. Please check your provider account if this persists.",
      logger,
    });
  }

  if (APICallError.isInstance(error)) {
    if (isIncorrectOpenAIAPIKeyError(error)) {
      return await addUserErrorMessageWithNotification({
        userId,
        userEmail,
        emailAccountId,
        errorType: ErrorType.INCORRECT_OPENAI_API_KEY,
        errorMessage:
          "Your OpenAI API key is invalid. Please update it in your settings.",
        logger,
      });
    }

    if (isInvalidAIModelError(error)) {
      await addUserErrorMessageWithNotification({
        userId,
        userEmail,
        emailAccountId,
        errorType: ErrorType.INVALID_AI_MODEL,
        errorMessage:
          "The AI model you specified does not exist. Please check your settings.",
        logger,
      });
      throw new SafeError(
        "The AI model you specified does not exist. Please update your AI settings.",
      );
    }

    if (isOpenAIAPIKeyDeactivatedError(error)) {
      return await addUserErrorMessageWithNotification({
        userId,
        userEmail,
        emailAccountId,
        errorType: ErrorType.OPENAI_API_KEY_DEACTIVATED,
        errorMessage:
          "Your OpenAI API key has been deactivated. Please update it in your settings.",
        logger,
      });
    }

  }
}
