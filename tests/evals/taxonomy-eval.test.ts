import { describe, expect, it } from "vitest";
import {
  TAXONOMY_TARGET_FULL,
  buildTaxonomyPatterns,
  evaluateTaxonomy,
} from "@/server/features/ai/evals/taxonomy";

describe("taxonomy eval harness", () => {
  it("builds 220 individual-scope patterns", () => {
    const patterns = buildTaxonomyPatterns();
    expect(patterns).toHaveLength(220);
    expect(patterns.every((p) => p.scope === "individual")).toBe(true);
  });

  it(`meets minimum full-support target (${TAXONOMY_TARGET_FULL}/220)`, () => {
    const evaluation = evaluateTaxonomy();
    expect(evaluation.full).toBeGreaterThanOrEqual(TAXONOMY_TARGET_FULL);
  });
});
