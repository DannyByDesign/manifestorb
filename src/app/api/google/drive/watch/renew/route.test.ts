import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { ensureGoogleDriveWatch } from "@/features/drive/sync/google";

vi.mock("@/server/db/client");
vi.mock("@/features/drive/sync/google", () => ({
  ensureGoogleDriveWatch: vi.fn(),
}));
vi.mock("@/env", () => ({
  env: { CRON_SECRET: "secret" },
}));

describe("POST /api/google/drive/watch/renew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    const req = new Request("http://localhost/api/google/drive/watch/renew", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("renews drive watches", async () => {
    prisma.driveConnection.findMany.mockResolvedValue([
      {
        id: "conn-1",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        emailAccountId: "email-1",
        googleChannelId: "ch-1",
        googleResourceId: "res-1",
        googleChannelToken: "token-1",
        googleChannelExpiresAt: null,
        googleStartPageToken: null,
      },
    ] as any);
    vi.mocked(ensureGoogleDriveWatch).mockResolvedValue(undefined as any);

    const req = new Request("http://localhost/api/google/drive/watch/renew", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(json.successful).toBe(1);
    expect(ensureGoogleDriveWatch).toHaveBeenCalled();
  });
});
