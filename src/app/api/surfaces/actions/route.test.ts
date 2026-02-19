import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const approveRoutePostMock = vi.fn();
const denyRoutePostMock = vi.fn();
const resolveAmbiguousTimePostMock = vi.fn();
const draftSendPostMock = vi.fn();
const draftDeleteMock = vi.fn();

vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "secret",
  },
}));

vi.mock("@/app/api/approvals/[id]/approve/route", () => ({
  POST: approveRoutePostMock,
}));

vi.mock("@/app/api/approvals/[id]/deny/route", () => ({
  POST: denyRoutePostMock,
}));

vi.mock("@/app/api/ambiguous-time/[id]/resolve/route", () => ({
  POST: resolveAmbiguousTimePostMock,
}));

vi.mock("@/app/api/drafts/[id]/send/route", () => ({
  POST: draftSendPostMock,
}));

vi.mock("@/app/api/drafts/[id]/route", () => ({
  DELETE: draftDeleteMock,
}));

describe("POST /api/surfaces/actions", () => {
  beforeEach(() => {
    approveRoutePostMock.mockReset();
    denyRoutePostMock.mockReset();
    resolveAmbiguousTimePostMock.mockReset();
    draftSendPostMock.mockReset();
    draftDeleteMock.mockReset();
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
    approveRoutePostMock.mockResolvedValueOnce(
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
    expect(approveRoutePostMock).toHaveBeenCalledTimes(1);

    const [internalReq, routeCtx] = approveRoutePostMock.mock.calls[0] as [
      NextRequest,
      { params: Promise<{ id: string }> },
    ];
    expect(internalReq.method).toBe("POST");
    expect(internalReq.nextUrl.pathname).toBe("/api/approvals/req-1/approve");
    expect(await internalReq.json()).toEqual({
      provider: "discord",
      userId: "U123",
      reason: undefined,
    });
    expect(await routeCtx.params).toEqual({ id: "req-1" });
  });

  it("proxies draft discard and forwards non-200 status", async () => {
    draftDeleteMock.mockResolvedValueOnce(
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
    expect(draftDeleteMock).toHaveBeenCalledTimes(1);

    const [internalReq, routeCtx] = draftDeleteMock.mock.calls[0] as [
      NextRequest,
      { params: Promise<{ id: string }> },
    ];
    expect(internalReq.method).toBe("DELETE");
    expect(internalReq.nextUrl.pathname).toBe("/api/drafts/d-1");
    expect(internalReq.nextUrl.searchParams.get("userId")).toBe("user-1");
    expect(internalReq.nextUrl.searchParams.get("emailAccountId")).toBe(
      "email-1",
    );
    expect(await routeCtx.params).toEqual({ id: "d-1" });
  });
});
