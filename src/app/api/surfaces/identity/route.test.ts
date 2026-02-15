import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");
vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "secret",
  },
}));

describe("POST /api/surfaces/identity", () => {
  beforeEach(() => {
    resetPrismaMock();
  });

  it("returns 401 when unauthorized", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/identity", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("resolves linked Slack account from providerTeamId + raw user id", async () => {
    prisma.account.findUnique.mockResolvedValueOnce({ userId: "user-1" } as never);

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/identity", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "slack",
        providerAccountId: "U123",
        providerTeamId: "T999",
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      status: "linked",
      linked: true,
      userId: "user-1",
      matchedProviderAccountId: "T999:U123",
    });
    expect(prisma.account.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerAccountId: {
          provider: "slack",
          providerAccountId: "T999:U123",
        },
      },
      select: { userId: true },
    });
  });

  it("returns unknown when suffix lookup is ambiguous", async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.account.findMany.mockResolvedValue([
      { userId: "u1", providerAccountId: "T1:U123" },
      { userId: "u2", providerAccountId: "T2:U123" },
    ] as never);

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/identity", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "slack",
        providerAccountId: "U123",
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      linked: false,
      status: "unknown",
      reason: "ambiguous_slack_account_suffix",
    });
  });

  it("returns unlinked when no account matches", async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.account.findMany.mockResolvedValue([]);

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/identity", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "slack",
        providerAccountId: "U404",
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: "unlinked", linked: false });
  });
});

