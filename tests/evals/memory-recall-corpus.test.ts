import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("memory recall eval corpus", () => {
  it("has valid shape", () => {
    const corpusPath = path.join(process.cwd(), "tests/evals/memory-recall-corpus.json");
    const parsed = JSON.parse(fs.readFileSync(corpusPath, "utf8")) as Array<Record<string, unknown>>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);

    for (const item of parsed) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.query).toBe("string");
      expect(Array.isArray(item.expectedAny)).toBe(true);
      expect(typeof item.intent).toBe("string");
    }
  });
});
