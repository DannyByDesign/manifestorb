import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));

import { getTool } from "./get";

describe("getTool draft branch", () => {
  it("returns draft details for provided IDs", async () => {
    const getDraft = vi
      .fn()
      .mockResolvedValueOnce({ id: "draft-1" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "draft-3" });

    const result = await getTool.execute(
      { resource: "draft", ids: ["draft-1", "draft-2", "draft-3"] },
      { userId: "user-1", providers: { email: { getDraft } } } as any,
    );

    expect(getDraft).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      success: true,
      data: [{ id: "draft-1" }, { id: "draft-3" }],
    });
  });
});
