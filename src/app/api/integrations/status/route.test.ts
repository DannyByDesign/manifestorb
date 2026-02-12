import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withError: (_scope: string, handler: unknown) => handler,
}));
vi.mock("@/server/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/server/features/integrations/status", () => ({
  getIntegrationStatusForUser: vi.fn(),
}));

import { auth } from "@/server/auth";
import { getIntegrationStatusForUser } from "@/server/features/integrations/status";
import { GET } from "./route";

describe("GET /api/integrations/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthenticated when no session exists", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const req = new NextRequest("https://web-production-d642.up.railway.app/api/integrations/status");

    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      {} as Parameters<typeof GET>[1],
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.authenticated).toBe(false);
  });

  it("returns integration status for authenticated user", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", name: "User" },
    } as never);
    vi.mocked(getIntegrationStatusForUser).mockResolvedValue({
      authenticated: true,
      gmail: { connected: true, reason: null },
      calendar: { connected: false, reason: "Calendar is not connected." },
      oauth: {
        baseUrl: "https://web-production-d642.up.railway.app",
        callbackUris: {
          gmail: "https://web-production-d642.up.railway.app/api/google/linking/callback",
          calendar: "https://web-production-d642.up.railway.app/api/google/calendar/callback",
        },
        config: {
          googleClientIdConfigured: true,
          googleClientSecretConfigured: true,
          workosRedirectConfigured: true,
        },
        warnings: [],
      },
    } as never);

    const req = new NextRequest("https://web-production-d642.up.railway.app/api/integrations/status");
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      {} as Parameters<typeof GET>[1],
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.authenticated).toBe(true);
    expect(getIntegrationStatusForUser).toHaveBeenCalledWith(
      "user-1",
      { id: "user-1", email: "user@example.com", name: "User" },
      "https://web-production-d642.up.railway.app",
    );
  });
});
