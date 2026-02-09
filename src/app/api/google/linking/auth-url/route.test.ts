import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withAuth: (_scope: string, handler: any) => handler,
}));
vi.mock("@/server/integrations/google/client", () => ({
  getLinkingOAuth2Client: vi.fn(),
}));
vi.mock("@/server/lib/oauth/state", () => ({
  generateOAuthState: vi.fn(),
  oauthStateCookieOptions: { path: "/" },
}));

import { getLinkingOAuth2Client } from "@/server/integrations/google/client";
import { generateOAuthState } from "@/server/lib/oauth/state";
import { GOOGLE_LINKING_STATE_COOKIE_NAME } from "@/server/integrations/google/constants";
import { GET } from "./route";

describe("GET /api/google/linking/auth-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateOAuthState).mockReturnValue("state-1" as any);
    vi.mocked(getLinkingOAuth2Client).mockReturnValue({
      generateAuthUrl: vi.fn().mockReturnValue("http://google/auth"),
    } as any);
  });

  it("returns auth url and sets state cookie", async () => {
    const req = new NextRequest("http://localhost/api/google/linking/auth-url");
    (req as any).auth = { userId: "user-1" };

    const res = await GET(req as any, {} as any);
    const json = await res.json();

    expect(json.url).toBe("http://google/auth");
    expect((res as any).cookies.get(GOOGLE_LINKING_STATE_COOKIE_NAME)?.value).toBe(
      "state-1",
    );
  });
});
