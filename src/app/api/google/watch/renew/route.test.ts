import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
import { ensureEmailAccountsWatched } from "@/server/integrations/google/watch-manager";

vi.mock("@/server/integrations/google/watch-manager", () => ({
  ensureEmailAccountsWatched: vi.fn(),
}));
vi.mock("@/env", () => ({
  env: { CRON_SECRET: "secret" },
}));

describe("POST /api/google/watch/renew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    const req = new Request("http://localhost/api/google/watch/renew", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("renews watches and returns counts", async () => {
    vi.mocked(ensureEmailAccountsWatched).mockResolvedValue([
      { status: "success" },
      { status: "error" },
      { status: "success" },
    ] as any);

    const req = new Request("http://localhost/api/google/watch/renew", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(json.successful).toBe(2);
    expect(json.failed).toBe(1);
  });
});
