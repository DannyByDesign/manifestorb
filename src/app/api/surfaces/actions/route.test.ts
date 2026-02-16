import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "secret",
  },
}));

describe("POST /api/surfaces/actions", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("returns 401 when unauthorized", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/actions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/actions", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "slack",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("proxies approval actions", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ decision: "APPROVED" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/actions", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "discord",
        providerAccountId: "U123",
        action: {
          type: "approval",
          requestId: "req-1",
          decision: "approve",
        },
      }),
    });

    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/api/approvals/req-1/approve",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("proxies draft discard and forwards non-200 status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Draft not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/actions", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "telegram",
        providerAccountId: "T123",
        action: {
          type: "draft",
          draftId: "d-1",
          decision: "discard",
          userId: "user-1",
          emailAccountId: "email-1",
        },
      }),
    });

    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json).toMatchObject({
      ok: false,
      status: 404,
      error: "Draft not found",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/api/drafts/d-1?userId=user-1&emailAccountId=email-1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
