import { describe, expect, it } from "vitest";
import { assertProviderFacingSchemaSafety } from "@/server/lib/llms/schema-safety";
import { ruleCompilerModelSchema } from "@/server/features/policy-plane/compiler";

describe("policy rule compiler schema", () => {
  it("stays provider-safe for structured output", () => {
    expect(() =>
      assertProviderFacingSchemaSafety({
        schema: ruleCompilerModelSchema,
        label: "Natural-language rule compiler",
      }),
    ).not.toThrow();
  });
});
