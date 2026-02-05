import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withEmailAccount: (_scope: string, handler: any) => handler,
}));
vi.mock("@/features/drive/client", () => ({
  getGoogleDriveOAuth2Url: vi.fn(),
}));
vi.mock("@/server/lib/oauth/state", () => ({
  generateOAuthState: vi.fn(),
  oauthStateCookieOptions: { path: "/" },
}));

import { getGoogleDriveOAuth2Url } from "@/features/drive/client";
import { generateOAuthState } from "@/server/lib/oauth/state";
import { DRIVE_STATE_COOKIE_NAME } from "@/features/drive/constants";
import { GET } from "./route";

describe("GET /api/google/drive/auth-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateOAuthState).mockReturnValue("state-1" as any);
    vi.mocked(getGoogleDriveOAuth2Url).mockReturnValue("http://google/drive");
  });

  it("returns auth url and sets state cookie", async () => {
    const req = new NextRequest("http://localhost/api/google/drive/auth-url");
    (req as any).auth = { emailAccountId: "email-1" };

    const res = await GET(req as any);
    const json = await res.json();

    expect(json.url).toBe("http://google/drive");
    expect(res.cookies.get(DRIVE_STATE_COOKIE_NAME)?.value).toBe("state-1");
  });
});
