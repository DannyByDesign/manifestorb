import { describe, expect, it, vi } from "vitest";

async function loadResolver({
  nodeEnv = "production",
  baseUrl = "https://app.example.com",
}: {
  nodeEnv?: "development" | "production" | "test";
  baseUrl?: string;
}) {
  vi.resetModules();
  process.env.NODE_ENV = nodeEnv;
  process.env.NEXT_PUBLIC_BASE_URL = baseUrl;
  return import("./base-url");
}

describe("resolveOAuthBaseUrl", () => {
  it("prefers forwarded origin in production when request origin is local", async () => {
    const { resolveOAuthBaseUrl } = await loadResolver({});
    const headers = new Headers({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "web-production-d642.up.railway.app",
    });

    const result = resolveOAuthBaseUrl("http://localhost:3000", headers);

    expect(result).toBe("https://web-production-d642.up.railway.app");
  });

  it("falls back to app base URL in production when request origin is local", async () => {
    const { resolveOAuthBaseUrl } = await loadResolver({
      baseUrl: "https://app.example.com",
    });

    const result = resolveOAuthBaseUrl("http://127.0.0.1:3000");

    expect(result).toBe("https://app.example.com");
  });

  it("uses request origin directly when it is already public", async () => {
    const { resolveOAuthBaseUrl } = await loadResolver({});

    const result = resolveOAuthBaseUrl("https://web-production-d642.up.railway.app");

    expect(result).toBe("https://web-production-d642.up.railway.app");
  });

  it("normalizes quoted base URL values", async () => {
    const { resolveOAuthBaseUrl } = await loadResolver({
      baseUrl: "\"https://app.example.com\"",
    });

    const result = resolveOAuthBaseUrl("http://localhost:3000");

    expect(result).toBe("https://app.example.com");
  });
});
