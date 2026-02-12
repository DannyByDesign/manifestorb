import { describe, expect, it } from "vitest";
import { deleteTool } from "./delete";

describe("deleteTool discriminated schema", () => {
  it("rejects unsupported resources", () => {
    const parsed = deleteTool.parameters.safeParse({
      resource: "unknown",
      ids: ["file-1"],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts calendar delete options", () => {
    const parsed = deleteTool.parameters.safeParse({
      resource: "calendar",
      ids: ["evt-1"],
      mode: "series",
      calendarId: "primary",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects resource-incompatible fields", () => {
    const parsed = deleteTool.parameters.safeParse({
      resource: "email",
      ids: ["msg-1"],
      mode: "single",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts draft delete payloads", () => {
    const parsed = deleteTool.parameters.safeParse({
      resource: "draft",
      ids: ["draft-1"],
    });
    expect(parsed.success).toBe(true);
  });
});
