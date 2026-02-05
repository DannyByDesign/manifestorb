import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { syncGoogleDriveChanges } from "@/features/drive/sync/google";

vi.mock("@/server/db/client");
vi.mock("@/features/drive/sync/google", () => ({
  syncGoogleDriveChanges: vi.fn(),
}));

describe("POST /api/google/drive/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when headers missing", async () => {
    const req = new Request("http://localhost/api/google/drive/webhook", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns ok when connection not found", async () => {
    prisma.driveConnection.findFirst.mockResolvedValue(null);
    const req = new Request("http://localhost/api/google/drive/webhook", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "ch-1",
        "x-goog-resource-id": "res-1",
      },
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("returns 403 on token mismatch", async () => {
    prisma.driveConnection.findFirst.mockResolvedValue({
      id: "conn-1",
      googleChannelToken: "token-1",
      googleChannelId: "ch-1",
      googleResourceId: "res-1",
      isConnected: true,
    } as any);
    const req = new Request("http://localhost/api/google/drive/webhook", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "ch-1",
        "x-goog-resource-id": "res-1",
        "x-goog-channel-token": "wrong",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("syncs drive changes when valid", async () => {
    prisma.driveConnection.findFirst.mockResolvedValue({
      id: "conn-1",
      googleChannelToken: "token-1",
      googleChannelId: "ch-1",
      googleResourceId: "res-1",
      isConnected: true,
      accessToken: "a",
      refreshToken: "r",
      expiresAt: null,
      emailAccountId: "email-1",
      googleChannelExpiresAt: null,
      googleStartPageToken: null,
    } as any);
    vi.mocked(syncGoogleDriveChanges).mockResolvedValue({
      changed: false,
      changes: [],
    } as any);

    const req = new Request("http://localhost/api/google/drive/webhook", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "ch-1",
        "x-goog-resource-id": "res-1",
        "x-goog-channel-token": "token-1",
      },
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(syncGoogleDriveChanges).toHaveBeenCalled();
  });
});
