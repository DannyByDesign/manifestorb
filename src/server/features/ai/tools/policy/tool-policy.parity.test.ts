import { describe, expect, it } from "vitest";
import { stripPluginOnlyAllowlist, type PluginToolGroups } from "@/server/features/ai/tools/policy/tool-policy";

function buildGroups(): PluginToolGroups {
  return {
    all: ["plugin.emailSearch"],
    byPlugin: new Map([["plugin-x", ["plugin.emailSearch"]]]),
    namedGroups: new Map([["group:plugins", ["plugin.emailSearch"]]]),
  };
}

describe("tool policy parity", () => {
  it("strips plugin-only allowlist so core tools stay available", () => {
    const groups = buildGroups();
    const resolved = stripPluginOnlyAllowlist(
      { allow: ["plugin-x"] },
      groups,
      new Set(["email.searchInbox", "calendar.listEvents"]),
    );

    expect(resolved.strippedAllowlist).toBe(true);
    expect(resolved.policy?.allow).toBeUndefined();
  });

  it("records unknown allowlist entries", () => {
    const groups = buildGroups();
    const resolved = stripPluginOnlyAllowlist(
      { allow: ["unknown-tool"] },
      groups,
      new Set(["email.searchInbox"]),
    );

    expect(resolved.unknownAllowlist).toEqual(["unknown-tool"]);
    expect(resolved.strippedAllowlist).toBe(true);
  });
});
