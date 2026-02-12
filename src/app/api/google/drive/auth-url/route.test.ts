import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withError: (_scope: string, handler: unknown) => handler,
}));
vi.mock("@/server/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  default: {
    emailAccount: {
      findFirst: vi.fn(),
    },
  },
}));
vi.mock("@/server/lib/oauth/google-connect", () => ({
  generateGoogleOAuthUrl: vi.fn(),
}));
vi.mock("@/server/lib/oauth/state", () => ({
  generateOAuthState: vi.fn(),
  oauthStateCookieOptions: { path: "/" },
}));

import { generateGoogleOAuthUrl } from "@/server/lib/oauth/google-connect";
import { generateOAuthState } from "@/server/lib/oauth/state";
import { DRIVE_STATE_COOKIE_NAME } from "@/features/drive/constants";
import { auth } from "@/server/auth";
import prisma from "@/server/db/client";
import { GET } from "./route";

describe("GET /api/google/drive/auth-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", email: "u@example.com", name: null },
    } as never);
    vi.mocked(prisma.emailAccount.findFirst).mockResolvedValue(
      { id: "email-1" } as never,
    );
    vi.mocked(generateOAuthState).mockReturnValue("state-1" as never);
    vi.mocked(generateGoogleOAuthUrl).mockReturnValue("http://google/drive");
  });

  it("returns auth url and sets state cookie", async () => {
    const req = new NextRequest("http://localhost/api/google/drive/auth-url");

    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      {} as Parameters<typeof GET>[1],
    );
    const json = await res.json();

    expect(json.url).toBe("http://google/drive");
    expect(res.cookies.get(DRIVE_STATE_COOKIE_NAME)?.value).toBe("state-1");
  });
});
