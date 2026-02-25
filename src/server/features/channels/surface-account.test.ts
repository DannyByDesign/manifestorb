import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

import {
  recordSurfaceIdentityMapping,
  resolveSurfaceAccount,
} from "@/server/features/channels/surface-account";

describe("surface-account identity mapping", () => {
  beforeEach(() => {
    resetPrismaMock();
  });

  it("resolves from UserChannelIdentity before Account fallback", async () => {
    prisma.userChannelIdentity.findUnique.mockResolvedValue({ userId: "user-identity" } as never);

    const result = await resolveSurfaceAccount({
      provider: "slack",
      providerAccountId: "U123",
      workspaceId: "T123",
    });

    expect(result).toEqual({
      userId: "user-identity",
      matchedProviderAccountId: "T123:U123",
      resolutionStatus: "linked",
    });
    expect(prisma.account.findUnique).not.toHaveBeenCalled();
  });

  it("upserts resolved channel identity mapping", async () => {
    prisma.userChannelIdentity.findUnique.mockResolvedValue(null as never);
    prisma.userChannelIdentity.upsert.mockResolvedValue({ id: "uci-1" } as never);

    await recordSurfaceIdentityMapping({
      userId: "user-1",
      provider: "slack",
      providerAccountId: "U1",
      workspaceId: "T1",
      metadata: { source: "test" },
    });

    expect(prisma.userChannelIdentity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalUserKey: {
            provider: "slack",
            externalUserKey: "T1:U1",
          },
        },
        create: expect.objectContaining({
          userId: "user-1",
          provider: "slack",
          externalUserKey: "T1:U1",
        }),
      }),
    );
  });
});
