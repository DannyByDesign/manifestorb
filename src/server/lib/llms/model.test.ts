import { describe, it, expect, vi, beforeEach } from "vitest";
import { getModel } from "./model";
import { Provider } from "./config";
import { env } from "@/env";
import type { UserAIFields } from "./types";

// Mock AI provider imports
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (model: string) => ({ model })),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => (model: string) => ({ model })),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => (model: string) => ({ model })),
}));

vi.mock("@/env", () => ({
  env: {
    DEFAULT_LLM_PROVIDER: "anthropic",
    ECONOMY_LLM_PROVIDER: "google",
    ECONOMY_LLM_MODEL: "gemini-2.0-flash",
    CHAT_LLM_PROVIDER: "google",
    CHAT_LLM_MODEL: "gemini-2.0-flash",
    OPENAI_API_KEY: "test-openai-key",
    GOOGLE_API_KEY: "test-google-key",
    ANTHROPIC_API_KEY: "test-anthropic-key",
  },
}));

vi.mock("server-only", () => ({}));

describe("Models", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(env).DEFAULT_LLM_PROVIDER = "anthropic";
    vi.mocked(env).DEFAULT_LLM_MODEL = undefined;
  });

  describe("getModel", () => {
    it("should use default provider (Anthropic) when user has no API key", () => {
      const userAi: UserAIFields = {
        aiApiKey: null,
        aiProvider: null,
        aiModel: null,
      };

      const result = getModel(userAi);
      expect(result.provider).toBe(Provider.ANTHROPIC);
      expect(result.modelName).toBe("claude-sonnet-4-5-20250929");
    });

    it("should use user's provider and model when API key is provided", () => {
      const userAi: UserAIFields = {
        aiApiKey: "user-api-key",
        aiProvider: Provider.GOOGLE,
        aiModel: "gemini-1.5-pro-latest",
      };

      const result = getModel(userAi);
      expect(result.provider).toBe(Provider.GOOGLE);
      expect(result.modelName).toBe("gemini-1.5-pro-latest");
    });

    it("should use user's API key with default provider when only API key is provided", () => {
      const userAi: UserAIFields = {
        aiApiKey: "user-api-key",
        aiProvider: null,
        aiModel: null,
      };

      const result = getModel(userAi);
      expect(result.provider).toBe(Provider.ANTHROPIC);
      expect(result.modelName).toBe("claude-sonnet-4-5-20250929");
    });

    it("should configure Google model correctly", () => {
      const userAi: UserAIFields = {
        aiApiKey: "user-api-key",
        aiProvider: Provider.GOOGLE,
        aiModel: "gemini-1.5-pro-latest",
      };

      const result = getModel(userAi);
      expect(result.provider).toBe(Provider.GOOGLE);
      expect(result.modelName).toBe("gemini-1.5-pro-latest");
      expect(result.model).toBeDefined();
    });

    it("should configure OpenAI model correctly", () => {
      const userAi: UserAIFields = {
        aiApiKey: "user-api-key",
        aiProvider: Provider.OPEN_AI,
        aiModel: "gpt-4o",
      };

      const result = getModel(userAi);
      expect(result.provider).toBe(Provider.OPEN_AI);
      expect(result.modelName).toBe("gpt-4o");
      expect(result.model).toBeDefined();
    });

    it("should configure Anthropic model correctly", () => {
      const userAi: UserAIFields = {
        aiApiKey: "user-api-key",
        aiProvider: Provider.ANTHROPIC,
        aiModel: "claude-3-7-sonnet-20250219",
      };

      const result = getModel(userAi);
      expect(result.provider).toBe(Provider.ANTHROPIC);
      expect(result.modelName).toBe("claude-3-7-sonnet-20250219");
      expect(result.model).toBeDefined();
    });

    it("should throw error for unsupported provider", () => {
      const userAi: UserAIFields = {
        aiApiKey: "user-api-key",
        aiProvider: "unsupported" as any,
        aiModel: "some-model",
      };

      expect(() => getModel(userAi)).toThrow("LLM provider not supported");
    });

    it("should use economy model (Google) when modelType is 'economy'", () => {
      const userAi: UserAIFields = {
        aiApiKey: null,
        aiProvider: null,
        aiModel: null,
      };

      vi.mocked(env).ECONOMY_LLM_PROVIDER = "google";
      vi.mocked(env).ECONOMY_LLM_MODEL = "gemini-2.0-flash";
      vi.mocked(env).GOOGLE_API_KEY = "test-google-key";

      const result = getModel(userAi, "economy");
      expect(result.provider).toBe(Provider.GOOGLE);
      expect(result.modelName).toBe("gemini-2.0-flash");
    });

    it("should use chat model (Google) when modelType is 'chat'", () => {
      const userAi: UserAIFields = {
        aiApiKey: null,
        aiProvider: null,
        aiModel: null,
      };

      vi.mocked(env).CHAT_LLM_PROVIDER = "google";
      vi.mocked(env).CHAT_LLM_MODEL = "gemini-2.0-flash";
      vi.mocked(env).GOOGLE_API_KEY = "test-google-key";

      const result = getModel(userAi, "chat");
      expect(result.provider).toBe(Provider.GOOGLE);
      expect(result.modelName).toBe("gemini-2.0-flash");
    });

    it("should use default model when modelType is 'default'", () => {
      const userAi: UserAIFields = {
        aiApiKey: null,
        aiProvider: null,
        aiModel: null,
      };

      vi.mocked(env).DEFAULT_LLM_PROVIDER = "anthropic";
      vi.mocked(env).DEFAULT_LLM_MODEL = undefined;

      const result = getModel(userAi, "default");
      expect(result.provider).toBe(Provider.ANTHROPIC);
      expect(result.modelName).toBe("claude-sonnet-4-5-20250929");
    });

    it("should fallback to Google for economy when configured", () => {
      const userAi: UserAIFields = {
        aiApiKey: null,
        aiProvider: null,
        aiModel: null,
      };

      // Clear economy config to trigger fallback
      vi.mocked(env).ECONOMY_LLM_PROVIDER = undefined;
      vi.mocked(env).ECONOMY_LLM_MODEL = undefined;
      vi.mocked(env).GOOGLE_API_KEY = "test-google-key";

      const result = getModel(userAi, "economy");
      // Should fallback to Google when no economy config
      expect(result.provider).toBe(Provider.GOOGLE);
      expect(result.modelName).toBe("gemini-2.0-flash");
    });

    it("should have backup model when using system API key", () => {
      const userAi: UserAIFields = {
        aiApiKey: null,
        aiProvider: null,
        aiModel: null,
      };

      vi.mocked(env).GOOGLE_API_KEY = "test-google-key";

      const result = getModel(userAi);
      expect(result.backupModel).toBeDefined();
    });

    it("should NOT have backup model when user provides own API key", () => {
      const userAi: UserAIFields = {
        aiApiKey: "user-own-key",
        aiProvider: Provider.ANTHROPIC,
        aiModel: null,
      };

      const result = getModel(userAi);
      expect(result.backupModel).toBeNull();
    });
  });
});
