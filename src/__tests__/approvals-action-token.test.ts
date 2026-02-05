/** biome-ignore-all lint/style/noMagicNumbers: test */
import { describe, expect, test, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    APPROVAL_ACTION_SECRET: "test-secret",
    AUTH_SECRET: "",
  },
}));

import {
  createApprovalActionToken,
  verifyApprovalActionToken,
} from "@/features/approvals/action-token";

describe("approval action tokens", () => {
  test("creates and verifies a valid token", () => {
    const token = createApprovalActionToken({
      approvalId: "approval-1",
      action: "approve",
      expiresInSeconds: 60,
    });

    const payload = verifyApprovalActionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.approvalId).toBe("approval-1");
    expect(payload?.action).toBe("approve");
  });

  test("returns null for expired token", () => {
    const token = createApprovalActionToken({
      approvalId: "approval-2",
      action: "deny",
      expiresInSeconds: -1,
    });

    expect(verifyApprovalActionToken(token)).toBeNull();
  });
});
