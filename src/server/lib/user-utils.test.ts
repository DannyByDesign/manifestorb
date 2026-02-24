import { describe, expect, it } from "vitest";
import {
  resolveEmailAccount,
  resolveEmailAccountFromMessageHint,
} from "@/server/lib/user-utils";

function account(id: string, email: string, updatedAt: string) {
  return {
    id,
    email,
    updatedAt: new Date(updatedAt),
  } as never;
}

describe("resolveEmailAccount", () => {
  it("returns preferred account when explicit id is provided", () => {
    const user = {
      emailAccounts: [
        account("acc-1", "one@example.com", "2026-02-20T00:00:00.000Z"),
        account("acc-2", "two@example.com", "2026-02-24T00:00:00.000Z"),
      ],
    };

    const resolved = resolveEmailAccount(user, "acc-1", { allowImplicit: false });
    expect(resolved?.id).toBe("acc-1");
  });

  it("returns null for ambiguous multi-account selection when implicit resolution is disabled", () => {
    const user = {
      emailAccounts: [
        account("acc-1", "one@example.com", "2026-02-20T00:00:00.000Z"),
        account("acc-2", "two@example.com", "2026-02-24T00:00:00.000Z"),
      ],
    };

    const resolved = resolveEmailAccount(user, null, { allowImplicit: false });
    expect(resolved).toBeNull();
  });

  it("allows deterministic fallback for single account even when implicit resolution is disabled", () => {
    const user = {
      emailAccounts: [
        account("acc-1", "one@example.com", "2026-02-24T00:00:00.000Z"),
      ],
    };

    const resolved = resolveEmailAccount(user, null, { allowImplicit: false });
    expect(resolved?.id).toBe("acc-1");
  });
});

describe("resolveEmailAccountFromMessageHint", () => {
  it("extracts account email mention from message content", () => {
    const user = {
      emailAccounts: [
        account("acc-1", "work@example.com", "2026-02-24T00:00:00.000Z"),
        account("acc-2", "home@example.com", "2026-02-23T00:00:00.000Z"),
      ],
    };

    const resolved = resolveEmailAccountFromMessageHint(
      user,
      "Use work@example.com for this request.",
    );

    expect(resolved?.id).toBe("acc-1");
  });
});
