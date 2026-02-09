import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withError: (_scope: string, handler: any) => handler,
}));
vi.mock("@/server/lib/oauth/callback-validation", () => ({
  validateOAuthCallback: vi.fn(),
}));
vi.mock("@/server/lib/redis/oauth-code", () => ({
  getOAuthCodeResult: vi.fn(),
  acquireOAuthCodeLock: vi.fn(),
  setOAuthCodeResult: vi.fn(),
  clearOAuthCode: vi.fn(),
}));
vi.mock("@/server/integrations/google/client", () => ({
  getLinkingOAuth2Client: vi.fn(),
}));
vi.mock("@/server/lib/oauth/account-linking", () => ({
  handleAccountLinking: vi.fn(),
}));
vi.mock("@/server/lib/user/merge-account", () => ({
  mergeAccount: vi.fn(),
}));
vi.mock("@/server/lib/oauth/error-handler", () => ({
  handleOAuthCallbackError: vi.fn().mockReturnValue(
    NextResponse.redirect("http://localhost:3000/accounts?error=oauth"),
  ),
}));
vi.mock("@/server/db/client");

import { validateOAuthCallback } from "@/server/lib/oauth/callback-validation";
import { getOAuthCodeResult } from "@/server/lib/redis/oauth-code";
import { GOOGLE_LINKING_STATE_COOKIE_NAME } from "@/server/integrations/google/constants";
import { GET } from "./route";

describe("GET /api/google/linking/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns validation response on failure", async () => {
    vi.mocked(validateOAuthCallback).mockReturnValue({
      success: false,
      response: NextResponse.json({ error: "bad" }, { status: 400 }),
    } as any);

    const req = new NextRequest(
      "http://localhost/api/google/linking/callback?code=bad&state=bad",
    );
    (req as any).logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      with: vi.fn().mockReturnThis(),
    };

    const res = await GET(req as any, {} as any);
    expect(res.status).toBe(400);
  });

  it("redirects using cached oauth result", async () => {
    vi.mocked(validateOAuthCallback).mockReturnValue({
      success: true,
      targetUserId: "user-1",
      code: "code-1",
    } as any);
    vi.mocked(getOAuthCodeResult).mockResolvedValue({
      params: { success: "tokens_updated" },
    } as any);

    const req = new NextRequest(
      "http://localhost/api/google/linking/callback?code=code-1&state=s1",
    );
    req.cookies.set(GOOGLE_LINKING_STATE_COOKIE_NAME, "s1");
    (req as any).logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      with: vi.fn().mockReturnThis(),
    };

    const res = await GET(req as any, {} as any);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(
      "http://localhost:3000/accounts?success=tokens_updated",
    );
    expect((res as any).cookies.get(GOOGLE_LINKING_STATE_COOKIE_NAME)?.value).toBe("");
  });
});
