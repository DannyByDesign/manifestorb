import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withError: (_scope: string, handler: unknown) => handler,
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
  getLinkingOAuth2ClientForBaseUrl: vi.fn(),
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
import {
  getOAuthCodeResult,
  acquireOAuthCodeLock,
} from "@/server/lib/redis/oauth-code";
import { getLinkingOAuth2ClientForBaseUrl } from "@/server/integrations/google/client";
import { handleOAuthCallbackError } from "@/server/lib/oauth/error-handler";
import { GOOGLE_LINKING_STATE_COOKIE_NAME } from "@/server/integrations/google/constants";
import { GET } from "./route";

type TestLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  with: ReturnType<typeof vi.fn>;
};

function attachLogger(req: NextRequest): NextRequest {
  const reqWithLogger = req as NextRequest & { logger: TestLogger };
  reqWithLogger.logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    with: vi.fn().mockReturnThis(),
  };
  return reqWithLogger;
}

describe("GET /api/google/linking/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns validation response on failure", async () => {
    vi.mocked(validateOAuthCallback).mockReturnValue({
      success: false,
      response: NextResponse.json({ error: "bad" }, { status: 400 }),
    } as never);

    const req = new NextRequest(
      "http://localhost/api/google/linking/callback?code=bad&state=bad",
    );
    const reqWithLogger = attachLogger(req);

    const res = await GET(
      reqWithLogger as Parameters<typeof GET>[0],
      {} as Parameters<typeof GET>[1],
    );
    expect(res.status).toBe(400);
  });

  it("redirects using cached oauth result", async () => {
    vi.mocked(validateOAuthCallback).mockReturnValue({
      success: true,
      targetUserId: "user-1",
      code: "code-1",
    } as never);
    vi.mocked(getOAuthCodeResult).mockResolvedValue({
      params: { success: "tokens_updated" },
    } as never);

    const req = new NextRequest(
      "http://localhost/api/google/linking/callback?code=code-1&state=s1",
    );
    req.cookies.set(GOOGLE_LINKING_STATE_COOKIE_NAME, "s1");
    const reqWithLogger = attachLogger(req);

    const res = await GET(
      reqWithLogger as Parameters<typeof GET>[0],
      {} as Parameters<typeof GET>[1],
    );
    const nextRes = res as NextResponse;

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(
      "http://localhost/accounts?success=tokens_updated",
    );
    expect(nextRes.cookies.get(GOOGLE_LINKING_STATE_COOKIE_NAME)?.value).toBe(
      "",
    );
  });

  it("continues callback flow when redis idempotency calls fail", async () => {
    vi.mocked(validateOAuthCallback).mockReturnValue({
      success: true,
      targetUserId: "user-1",
      code: "code-1",
    } as never);
    vi.mocked(getOAuthCodeResult).mockRejectedValue(new Error("redis down"));
    vi.mocked(acquireOAuthCodeLock).mockRejectedValue(new Error("redis down"));

    const getToken = vi.fn().mockResolvedValue({ tokens: {} });
    const verifyIdToken = vi.fn();
    vi.mocked(getLinkingOAuth2ClientForBaseUrl).mockReturnValue({
      getToken,
      verifyIdToken,
    } as never);

    const req = new NextRequest(
      "http://localhost/api/google/linking/callback?code=code-1&state=s1",
    );
    req.cookies.set(GOOGLE_LINKING_STATE_COOKIE_NAME, "s1");
    const reqWithLogger = attachLogger(req);

    await GET(
      reqWithLogger as Parameters<typeof GET>[0],
      {} as Parameters<typeof GET>[1],
    );

    expect(getToken).toHaveBeenCalledWith("code-1");
    expect(handleOAuthCallbackError).toHaveBeenCalled();
  });
});
