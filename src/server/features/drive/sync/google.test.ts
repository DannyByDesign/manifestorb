import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ensureGoogleDriveWatch,
  syncGoogleDriveChanges,
} from "@/server/features/drive/sync/google";
import prisma from "@/server/lib/__mocks__/prisma";

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_BASE_URL: "http://localhost:3000" as string | undefined,
}));
vi.mock("@/env", () => ({ env: mockEnv }));

const mockDriveClient = vi.hoisted(() => ({
  changes: {
    getStartPageToken: vi.fn(),
    watch: vi.fn(),
    list: vi.fn(),
  },
}));

const MockOAuth2 = vi.hoisted(
  () =>
    class {
      setCredentials = vi.fn();
    },
);

vi.mock("@googleapis/drive", () => ({
  auth: {
    OAuth2: MockOAuth2,
  },
  drive: vi.fn().mockReturnValue(mockDriveClient),
}));
vi.mock("@/server/db/client");

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
} as any;

describe("drive sync/google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDriveClient.changes.getStartPageToken.mockResolvedValue({
      data: { startPageToken: "start-1" },
    });
    mockDriveClient.changes.watch.mockResolvedValue({
      data: { resourceId: "res-1", expiration: `${Date.now() + 1000}` },
    });
  });

  it("skips watch when base url missing", async () => {
    mockEnv.NEXT_PUBLIC_BASE_URL = undefined;
    await ensureGoogleDriveWatch({
      connection: {
        id: "conn-1",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3600_000),
        emailAccountId: "email-1",
        googleChannelId: null,
        googleResourceId: null,
        googleChannelToken: null,
        googleChannelExpiresAt: null,
        googleStartPageToken: null,
      },
      logger,
    });
    expect(prisma.driveConnection.update).not.toHaveBeenCalled();
  });

  it("watches drive and updates connection", async () => {
    mockEnv.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
    await ensureGoogleDriveWatch({
      connection: {
        id: "conn-1",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3600_000),
        emailAccountId: "email-1",
        googleChannelId: null,
        googleResourceId: null,
        googleChannelToken: null,
        googleChannelExpiresAt: null,
        googleStartPageToken: null,
      },
      logger,
    });
    expect(prisma.driveConnection.update).toHaveBeenCalled();
  });

  it("syncs drive changes and updates start page token", async () => {
    mockDriveClient.changes.list.mockResolvedValue({
      data: {
        changes: [{ fileId: "f1" }],
        newStartPageToken: "start-2",
      },
    });
    const result = await syncGoogleDriveChanges({
      connection: {
        id: "conn-1",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3600_000),
        emailAccountId: "email-1",
        googleChannelId: "ch-1",
        googleResourceId: "res-1",
        googleChannelToken: "token-1",
        googleChannelExpiresAt: null,
        googleStartPageToken: "start-1",
      },
      logger,
    });

    expect(result.changed).toBe(true);
    expect(prisma.driveConnection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { googleStartPageToken: "start-2" },
    });
  });
});
