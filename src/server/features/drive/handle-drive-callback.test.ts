import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { handleDriveCallback } from "@/server/features/drive/handle-drive-callback";
import prisma from "@/server/lib/__mocks__/prisma";
import { ensureGoogleDriveWatch } from "@/server/features/drive/sync/google";
import {
  acquireOAuthCodeLock,
  getOAuthCodeResult,
  setOAuthCodeResult,
} from "@/server/lib/redis/oauth-code";
import { verifyEmailAccountAccess } from "@/server/lib/oauth/verify";
import { DRIVE_STATE_COOKIE_NAME } from "@/server/features/drive/constants";
import { generateOAuthState } from "@/server/lib/oauth/state";

vi.mock("@/server/db/client");
vi.mock("@/server/features/drive/sync/google", () => ({
  ensureGoogleDriveWatch: vi.fn(),
}));
vi.mock("@/server/lib/redis/oauth-code", () => ({
  acquireOAuthCodeLock: vi.fn(),
  getOAuthCodeResult: vi.fn(),
  setOAuthCodeResult: vi.fn(),
  clearOAuthCode: vi.fn(),
}));
vi.mock("@/server/lib/oauth/verify", () => ({
  verifyEmailAccountAccess: vi.fn(),
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as any;

describe("handleDriveCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects using cached result when code already processed", async () => {
    vi.mocked(getOAuthCodeResult).mockResolvedValue({
      params: { message: "drive_connected" },
    } as any);

    const state = generateOAuthState({ emailAccountId: "email-1", type: "drive" });
    const req = new NextRequest(
      `http://localhost/api/google/drive/callback?code=1234567890&state=${state}`,
    );
    req.cookies.set(DRIVE_STATE_COOKIE_NAME, state);

    const res = await handleDriveCallback(
      req,
      { name: "google", exchangeCodeForTokens: vi.fn() },
      logger,
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/drive");
  });

  it("creates drive connection and schedules watch", async () => {
    vi.mocked(getOAuthCodeResult).mockResolvedValue(null as any);
    vi.mocked(acquireOAuthCodeLock).mockResolvedValue(true as any);
    vi.mocked(verifyEmailAccountAccess).mockResolvedValue(undefined as any);
    vi.mocked(setOAuthCodeResult).mockResolvedValue(undefined as any);
    prisma.driveConnection.upsert.mockResolvedValue({
      id: "conn-1",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: null,
      emailAccountId: "email-1",
      googleChannelId: null,
      googleResourceId: null,
      googleChannelToken: null,
      googleChannelExpiresAt: null,
      googleStartPageToken: null,
    } as any);

    const state = generateOAuthState({ emailAccountId: "email-1", type: "drive" });
    const req = new NextRequest(
      `http://localhost/api/google/drive/callback?code=1234567890&state=${state}`,
    );
    req.cookies.set(DRIVE_STATE_COOKIE_NAME, state);

    const provider = {
      name: "google" as const,
      exchangeCodeForTokens: vi.fn().mockResolvedValue({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        email: "user@test.com",
      }),
    };

    const res = await handleDriveCallback(req, provider, logger);
    expect(res.status).toBe(307);
    expect(ensureGoogleDriveWatch).toHaveBeenCalled();
  });
});
