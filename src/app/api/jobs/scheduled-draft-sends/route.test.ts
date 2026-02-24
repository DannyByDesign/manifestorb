import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");
vi.mock("@/env", () => ({
  env: {
    CRON_SECRET: "secret",
    JOBS_SHARED_SECRET: "jobs-secret",
  },
}));
vi.mock("@/features/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));
vi.mock("@/features/drafts/operations", () => ({
  sendDraftById: vi.fn(),
}));

describe("scheduled draft send jobs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports orphaned pending rows in dryRun without mutating state", async () => {
    prisma.scheduledDraftSend.count
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(4 as never);
    prisma.scheduledDraftSend.findMany.mockResolvedValueOnce([] as never);
    prisma.scheduledDraftSend.findFirst.mockResolvedValueOnce(null as never);

    const req = new Request("http://localhost/api/jobs/scheduled-draft-sends", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({ dryRun: true, maxJobs: 25 }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.orphanedPendingCount).toBe(2);
    expect(prisma.scheduledDraftSend.updateMany).not.toHaveBeenCalled();
  });

  it("reconciles orphaned pending rows to FAILED before due processing", async () => {
    prisma.scheduledDraftSend.count
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(3 as never);
    prisma.scheduledDraftSend.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prisma.scheduledDraftSend.findMany.mockResolvedValueOnce([] as never);
    prisma.scheduledDraftSend.findFirst.mockResolvedValueOnce(null as never);

    const req = new Request("http://localhost/api/jobs/scheduled-draft-sends", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({ maxJobs: 10 }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.reconciledOrphans).toBe(1);
    expect(prisma.scheduledDraftSend.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
          scheduledId: null,
        }),
        data: expect.objectContaining({
          status: "FAILED",
        }),
      }),
    );
  });

  it("GET health remains authorized by cron secret", async () => {
    prisma.scheduledDraftSend.count.mockResolvedValueOnce(0 as never);
    prisma.scheduledDraftSend.findFirst.mockResolvedValueOnce(null as never);

    const req = new Request("http://localhost/api/jobs/scheduled-draft-sends", {
      method: "GET",
      headers: { authorization: "Bearer secret" },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
