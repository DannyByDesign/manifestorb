import { describe, it, expect, vi, beforeEach } from "vitest";
import { getModel } from "./model";
import { Provider } from "./config";
import { env } from "@/env";

// Mock AI provider imports
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => (model: string) => ({ model })),
}));

vi.mock("@/env", () => ({
  env: {
    DEFAULT_LLM_PROVIDER: "google",
    DEFAULT_LLM_MODEL: "gemini-2.5-flash",
    ECONOMY_LLM_MODEL: "gemini-2.5-flash",
    CHAT_LLM_MODEL: "gemini-2.5-flash",
    GOOGLE_API_KEY: "test-google-key",
  },
}));

vi.mock("server-only", () => ({}));

describe("Models", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(env).DEFAULT_LLM_MODEL = "gemini-2.5-flash";
  });

  describe("getModel", () => {
    it("should use default Google Gemini model", () => {
      const result = getModel();
      expect(result.provider).toBe(Provider.GOOGLE);
      expect(result.modelName).toBe("gemini-2.5-flash");
    });

    it("should use economy model when modelType is 'economy'", () => {
      vi.mocked(env).ECONOMY_LLM_MODEL = "gemini-2.5-flash";

      const result = getModel("economy");
      expect(result.provider).toBe(Provider.GOOGLE);
      expect(result.modelName).toBe("gemini-2.5-flash");
    });

    it("should use chat model when modelType is 'chat'", () => {
      vi.mocked(env).CHAT_LLM_MODEL = "gemini-2.5-flash";

      const result = getModel("chat");
      expect(result.provider).toBe(Provider.GOOGLE);
      expect(result.modelName).toBe("gemini-2.5-flash");
    });

    it("should have backup model available", () => {
      vi.mocked(env).GOOGLE_API_KEY = "test-google-key";

      const result = getModel();
      expect(result.backupModel).toBeDefined();
    });

    it("should not have backup model when GOOGLE_API_KEY is not set", () => {
      vi.mocked(env).GOOGLE_API_KEY = undefined;

      const result = getModel();
      expect(result.backupModel).toBeNull();
    });
  });
});
