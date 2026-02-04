import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidInternalApiKey, INTERNAL_API_KEY_HEADER } from "./internal-api";
import { env } from "@/env";

vi.mock("@/env", () => ({
  env: {
    INTERNAL_API_KEY: "test-internal-key",
    INTERNAL_API_URL: "http://localhost:3000",
    NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
  },
}));

const mockLogger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  with: vi.fn().mockReturnThis(),
};

const buildHeaders = (value?: string | null) => {
  const headers = new Headers();
  if (value !== undefined && value !== null) {
    headers.set(INTERNAL_API_KEY_HEADER, value);
  }
  return headers;
};

describe("internal-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as any).INTERNAL_API_KEY = "test-internal-key";
  });

  it("returns true for valid internal API key", () => {
    const headers = buildHeaders("test-internal-key");
    const result = isValidInternalApiKey(headers, mockLogger as any);
    expect(result).toBe(true);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns false for invalid internal API key", () => {
    const headers = buildHeaders("wrong-key");
    const result = isValidInternalApiKey(headers, mockLogger as any);
    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("returns false when INTERNAL_API_KEY is missing", () => {
    (env as any).INTERNAL_API_KEY = "";
    const headers = buildHeaders("test-internal-key");
    const result = isValidInternalApiKey(headers, mockLogger as any);
    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
