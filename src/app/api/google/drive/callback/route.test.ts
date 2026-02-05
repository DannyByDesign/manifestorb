import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withError: (_scope: string, handler: any) => handler,
}));
vi.mock("@/features/drive/handle-drive-callback", () => ({
  handleDriveCallback: vi.fn(),
}));
vi.mock("@/features/drive/client", () => ({
  exchangeGoogleDriveCode: vi.fn(),
}));

import { handleDriveCallback } from "@/features/drive/handle-drive-callback";
import { GET } from "./route";

describe("GET /api/google/drive/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to handleDriveCallback", async () => {
    vi.mocked(handleDriveCallback).mockResolvedValue(
      NextResponse.json({ ok: true }),
    );

    const req = new NextRequest(
      "http://localhost/api/google/drive/callback?code=1&state=2",
    );
    (req as any).logger = { info: vi.fn(), error: vi.fn(), with: vi.fn() };

    const res = await GET(req as any);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(handleDriveCallback).toHaveBeenCalled();
  });
});
