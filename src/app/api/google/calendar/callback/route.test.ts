import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/server/lib/middleware", () => ({
  withError: (_scope: string, handler: any) => handler,
}));
vi.mock("@/features/calendar/handle-calendar-callback", () => ({
  handleCalendarCallback: vi.fn(),
}));
vi.mock("@/features/calendar/providers/google", () => ({
  createGoogleCalendarProvider: vi.fn(),
}));

import { handleCalendarCallback } from "@/features/calendar/handle-calendar-callback";
import { createGoogleCalendarProvider } from "@/features/calendar/providers/google";
import { GET } from "./route";

describe("GET /api/google/calendar/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to handleCalendarCallback", async () => {
    vi.mocked(handleCalendarCallback).mockResolvedValue(
      NextResponse.json({ ok: true }),
    );
    vi.mocked(createGoogleCalendarProvider).mockReturnValue({} as any);

    const req = new NextRequest(
      "http://localhost/api/google/calendar/callback?code=1&state=2",
    );
    (req as any).logger = { info: vi.fn(), error: vi.fn(), with: vi.fn() };

    const res = await GET(req as any, {} as any);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(handleCalendarCallback).toHaveBeenCalled();
  });
});
