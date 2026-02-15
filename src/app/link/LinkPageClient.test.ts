import { describe, expect, it } from "vitest";
import { buildLinkLoginRedirect } from "./LinkPageClient";

describe("buildLinkLoginRedirect", () => {
  it("builds login redirect with encoded returnTo link token", () => {
    const redirect = buildLinkLoginRedirect("abc123");
    expect(redirect).toBe("/login?returnTo=%2Flink%3Ftoken%3Dabc123");
  });

  it("encodes special characters in token", () => {
    const redirect = buildLinkLoginRedirect("t+/=x y");
    expect(redirect).toBe(
      "/login?returnTo=%2Flink%3Ftoken%3Dt%252B%252F%253Dx%2520y",
    );
  });
});

