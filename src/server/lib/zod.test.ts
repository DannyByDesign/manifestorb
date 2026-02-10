import { describe, expect, it } from "vitest";
import { z } from "zod";
import { booleanString } from "@/server/lib/zod";

describe("booleanString", () => {
  const schema = z.object({
    flag: booleanString.default(false),
  });

  it("parses explicit false strings as false", () => {
    expect(schema.parse({ flag: "false" }).flag).toBe(false);
    expect(schema.parse({ flag: "0" }).flag).toBe(false);
    expect(schema.parse({ flag: "no" }).flag).toBe(false);
    expect(schema.parse({ flag: "off" }).flag).toBe(false);
  });

  it("parses explicit true strings as true", () => {
    expect(schema.parse({ flag: "true" }).flag).toBe(true);
    expect(schema.parse({ flag: "1" }).flag).toBe(true);
    expect(schema.parse({ flag: "yes" }).flag).toBe(true);
    expect(schema.parse({ flag: "on" }).flag).toBe(true);
  });

  it("falls back to default when value is absent or empty", () => {
    expect(schema.parse({}).flag).toBe(false);
    expect(schema.parse({ flag: "" }).flag).toBe(false);
  });
});
