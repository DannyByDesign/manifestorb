import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withEmailAccount: (_scope: string, handler: any) => handler,
}));
vi.mock("@/features/calendar/client", () => ({
  getCalendarOAuth2Client: vi.fn(),
}));
vi.mock("@/server/lib/oauth/state", () => ({
  generateOAuthState: vi.fn(),
  oauthStateCookieOptions: { path: "/" },
}));

import { getCalendarOAuth2Client } from "@/features/calendar/client";
import { generateOAuthState } from "@/server/lib/oauth/state";
import { CALENDAR_STATE_COOKIE_NAME } from "@/features/calendar/constants";
import { GET } from "./route";

describe("GET /api/google/calendar/auth-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateOAuthState).mockReturnValue("state-1" as any);
    vi.mocked(getCalendarOAuth2Client).mockReturnValue({
      generateAuthUrl: vi.fn().mockReturnValue("http://google/calendar"),
    } as any);
  });

  it("returns auth url and sets state cookie", async () => {
    const req = new NextRequest("http://localhost/api/google/calendar/auth-url");
    (req as any).auth = { emailAccountId: "email-1" };

    const res = await GET(req as any);
    const json = await res.json();

    expect(json.url).toBe("http://google/calendar");
    expect(res.cookies.get(CALENDAR_STATE_COOKIE_NAME)?.value).toBe("state-1");
  });
});
