import { describe, it, expect, vi } from "vitest";
import { matchesStaticRule } from "./match-rules";
import {
  logger,
  getStaticRule,
  getMessage,
  getHeaders,
} from "./match-rules.test-helpers";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/features/rules/ai/ai-choose-rule", () => ({ aiChooseRule: vi.fn() }));
vi.mock("@/features/reply-tracker/check-sender-reply-history", () => ({
  checkSenderReplyHistory: vi.fn(),
}));
vi.mock("@/features/cold-email/cold-email-rule", () => ({
  getColdEmailRule: vi.fn(),
  isColdEmailRuleEnabled: vi.fn(),
}));
vi.mock("@/features/cold-email/is-cold-email", () => ({ isColdEmail: vi.fn() }));

describe("matchesStaticRule", () => {
  it("should match wildcard pattern at start of email", () => {
    const rule = getStaticRule({ from: "*@gmail.com" });
    const message = getMessage({
      headers: getHeaders({ from: "test@gmail.com" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should not match when wildcard pattern doesn't match domain", () => {
    const rule = getStaticRule({ from: "*@gmail.com" });
    const message = getMessage({
      headers: getHeaders({ from: "test@yahoo.com" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(false);
  });

  it("should handle multiple wildcards in pattern", () => {
    const rule = getStaticRule({ subject: "*important*" });
    const message = getMessage({
      headers: getHeaders({ subject: "This is important message" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should handle invalid regex patterns gracefully", () => {
    const rule = getStaticRule({ from: "[invalid(regex" });
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(false);
  });

  it("should return false when no conditions are provided", () => {
    const rule = getStaticRule({});
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(false);
  });

  it("should match body content with wildcard", () => {
    const rule = getStaticRule({ body: "*unsubscribe*" });
    const message = getMessage({
      headers: getHeaders(),
      textPlain: "Click here to unsubscribe from our newsletter",
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match @domain.com", () => {
    const rule = getStaticRule({ from: "@domain.com" });
    const message = getMessage({
      headers: getHeaders({ from: "test@domain.com" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match Creator Message subject pattern", () => {
    const rule = getStaticRule({ subject: "[Creator Message]*" });
    const message = getMessage({
      headers: getHeaders({
        subject: "[Creator Message] Contact - new submission",
      }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match exact Creator Message subject", () => {
    const rule = getStaticRule({
      subject: "[Creator Message] Contact - new submission",
    });
    const message = getMessage({
      headers: getHeaders({
        subject: "[Creator Message] Contact - new submission",
      }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match parentheses in subject", () => {
    const rule = getStaticRule({ subject: "Invoice (PDF)" });
    const message = getMessage({
      headers: getHeaders({ subject: "Invoice (PDF)" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match plus sign in email address", () => {
    const rule = getStaticRule({ from: "user+tag@gmail.com" });
    const message = getMessage({
      headers: getHeaders({ from: "user+tag@gmail.com" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match dots in subject", () => {
    const rule = getStaticRule({ subject: "Order #123.456" });
    const message = getMessage({
      headers: getHeaders({ subject: "Order #123.456" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match dollar signs in subject", () => {
    const rule = getStaticRule({ subject: "Payment $100" });
    const message = getMessage({
      headers: getHeaders({ subject: "Payment $100" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match curly braces in subject", () => {
    const rule = getStaticRule({ subject: "Template {name}" });
    const message = getMessage({
      headers: getHeaders({ subject: "Template {name}" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match pipe symbol in subject", () => {
    const rule = getStaticRule({ subject: "Alert | System" });
    const message = getMessage({
      headers: getHeaders({ subject: "Alert | System" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match question mark in subject", () => {
    const rule = getStaticRule({ subject: "Are you ready?" });
    const message = getMessage({
      headers: getHeaders({ subject: "Are you ready?" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match caret symbol in subject", () => {
    const rule = getStaticRule({ subject: "Version ^1.0" });
    const message = getMessage({
      headers: getHeaders({ subject: "Version ^1.0" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match wildcards with special characters", () => {
    const rule = getStaticRule({ subject: "*[Important]*" });
    const message = getMessage({
      headers: getHeaders({ subject: "URGENT [Important] Notice" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match common notification patterns", () => {
    const rule = getStaticRule({ from: "*notification*@*" });
    const message = getMessage({
      headers: getHeaders({ from: "noreply-notification@company.com" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match receipt patterns", () => {
    const rule = getStaticRule({ subject: "*receipt*" });
    const message = getMessage({
      headers: getHeaders({ subject: "Your receipt from store" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should be case sensitive", () => {
    const rule = getStaticRule({ subject: "URGENT" });
    const message = getMessage({
      headers: getHeaders({ subject: "urgent" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(false);
  });

  it("should handle empty header values gracefully", () => {
    const rule = getStaticRule({ from: "test@example.com" });
    const message = getMessage({
      headers: getHeaders({ from: "" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(false);
  });

  it("should match backslash characters", () => {
    const rule = getStaticRule({ subject: "Path: C:\\Users\\Name" });
    const message = getMessage({
      headers: getHeaders({ subject: "Path: C:\\Users\\Name" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should match multiple domains separated by pipe characters", () => {
    const rule = getStaticRule({
      from: "@company-a.com|@company-b.org|@startup-x.io|@agency-y.net|@brand-z.co",
    });

    const message1 = getMessage({
      headers: getHeaders({ from: "user@company-a.com" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ from: "contact@startup-x.io" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);

    const message3 = getMessage({
      headers: getHeaders({ from: "info@brand-z.co" }),
    });
    expect(matchesStaticRule(rule, message3, logger)).toBe(true);

    const message4 = getMessage({
      headers: getHeaders({ from: "test@other-company.com" }),
    });
    expect(matchesStaticRule(rule, message4, logger)).toBe(false);
  });

  it("should treat pipes as OR operator in 'to' field", () => {
    const rule = getStaticRule({
      to: "support@company.com|help@company.com|contact@company.com",
    });

    const message1 = getMessage({
      headers: getHeaders({ to: "support@company.com" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ to: "help@company.com" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);

    const message3 = getMessage({
      headers: getHeaders({ to: "contact@company.com" }),
    });
    expect(matchesStaticRule(rule, message3, logger)).toBe(true);

    const message4 = getMessage({
      headers: getHeaders({ to: "sales@company.com" }),
    });
    expect(matchesStaticRule(rule, message4, logger)).toBe(false);
  });

  it("should combine wildcards with pipe OR logic in from field", () => {
    const rule = getStaticRule({
      from: "*@newsletter.com|*@marketing.org|notifications@*",
    });

    const message1 = getMessage({
      headers: getHeaders({ from: "weekly@newsletter.com" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ from: "campaign@marketing.org" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);

    const message3 = getMessage({
      headers: getHeaders({ from: "notifications@example.com" }),
    });
    expect(matchesStaticRule(rule, message3, logger)).toBe(true);

    const message4 = getMessage({
      headers: getHeaders({ from: "test@other.com" }),
    });
    expect(matchesStaticRule(rule, message4, logger)).toBe(false);
  });

  it("should treat pipes as literal characters in subject field", () => {
    const rule = getStaticRule({
      subject: "Status: Active | Pending | Completed",
    });
    const message = getMessage({
      headers: getHeaders({ subject: "Status: Active | Pending | Completed" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ subject: "Status: Active" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(false);
  });

  it("should treat pipes as literal characters in body field", () => {
    const rule = getStaticRule({
      body: "Choose option A | B | C from the menu",
    });
    const message = getMessage({
      headers: getHeaders(),
      textPlain: "Please choose option A | B | C from the menu to continue",
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders(),
      textPlain: "Please choose option A to continue",
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(false);
  });

  it("should handle empty patterns between pipes gracefully", () => {
    const rule = getStaticRule({ from: "@domain1.com||@domain2.com" });

    const message1 = getMessage({
      headers: getHeaders({ from: "test@domain1.com" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ from: "test@domain2.com" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);
  });

  it("should handle single pattern without pipes in from field", () => {
    const rule = getStaticRule({ from: "@single-domain.com" });
    const message = getMessage({
      headers: getHeaders({ from: "user@single-domain.com" }),
    });

    expect(matchesStaticRule(rule, message, logger)).toBe(true);
  });

  it("should handle pipes at beginning and end of from pattern", () => {
    const rule = getStaticRule({ from: "|@domain1.com|@domain2.com|" });

    const message1 = getMessage({
      headers: getHeaders({ from: "test@domain1.com" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ from: "test@domain2.com" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);
  });

  it("should handle mixed conditions with pipes in from and literal pipes in subject", () => {
    const rule = getStaticRule({
      from: "@company1.com|@company2.com",
      subject: "Alert | System Status",
    });

    const message1 = getMessage({
      headers: getHeaders({
        from: "admin@company1.com",
        subject: "Alert | System Status",
      }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({
        from: "admin@company2.com",
        subject: "Alert | System Status",
      }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);

    const message3 = getMessage({
      headers: getHeaders({
        from: "admin@company3.com",
        subject: "Alert | System Status",
      }),
    });
    expect(matchesStaticRule(rule, message3, logger)).toBe(false);

    const message4 = getMessage({
      headers: getHeaders({
        from: "admin@company1.com",
        subject: "Alert",
      }),
    });
    expect(matchesStaticRule(rule, message4, logger)).toBe(false);
  });

  it("should handle complex email patterns with pipes", () => {
    const rule = getStaticRule({
      from: "noreply@*|*-notifications@company.com|alerts+*@service.io",
    });

    const message1 = getMessage({
      headers: getHeaders({ from: "noreply@newsletter.com" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ from: "system-notifications@company.com" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);

    const message3 = getMessage({
      headers: getHeaders({ from: "alerts+billing@service.io" }),
    });
    expect(matchesStaticRule(rule, message3, logger)).toBe(true);

    const message4 = getMessage({
      headers: getHeaders({ from: "user@other.com" }),
    });
    expect(matchesStaticRule(rule, message4, logger)).toBe(false);
  });

  it("should support comma as separator in from field", () => {
    const rule = getStaticRule({
      from: "@company-a.com, @company-b.org, @startup-x.io",
    });

    const message1 = getMessage({
      headers: getHeaders({ from: "user@company-a.com" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ from: "contact@company-b.org" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);

    const message3 = getMessage({
      headers: getHeaders({ from: "info@startup-x.io" }),
    });
    expect(matchesStaticRule(rule, message3, logger)).toBe(true);

    const message4 = getMessage({
      headers: getHeaders({ from: "test@other.com" }),
    });
    expect(matchesStaticRule(rule, message4, logger)).toBe(false);
  });

  it("should support comma as separator in to field", () => {
    const rule = getStaticRule({
      to: "support@company.com, help@company.com, contact@company.com",
    });

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ to: "support@company.com" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ to: "help@company.com" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ to: "contact@company.com" }),
        }),
        logger,
      ),
    ).toBe(true);
  });

  it("should support OR as separator (case insensitive)", () => {
    const rule = getStaticRule({
      from: "@company1.com OR @company2.com or @company3.com",
    });

    const message1 = getMessage({
      headers: getHeaders({ from: "admin@company1.com" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ from: "admin@company2.com" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(true);

    const message3 = getMessage({
      headers: getHeaders({ from: "admin@company3.com" }),
    });
    expect(matchesStaticRule(rule, message3, logger)).toBe(true);

    const message4 = getMessage({
      headers: getHeaders({ from: "admin@company4.com" }),
    });
    expect(matchesStaticRule(rule, message4, logger)).toBe(false);
  });

  it("should support mixed separators (pipe, comma, OR)", () => {
    const rule = getStaticRule({
      from: "@company1.com | @company2.com, @company3.com OR @company4.com",
    });

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "user@company1.com" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "user@company2.com" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "user@company3.com" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "user@company4.com" }),
        }),
        logger,
      ),
    ).toBe(true);
  });

  it("should handle OR with various spacing", () => {
    const rule = getStaticRule({
      from: "@company1.com  OR  @company2.com OR@company3.com",
    });

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "user@company1.com" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "user@company2.com" }),
        }),
        logger,
      ),
    ).toBe(true);
  });

  it("should combine wildcards with comma separator", () => {
    const rule = getStaticRule({
      from: "*@newsletter.com, *@marketing.org, notifications@*",
    });

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "weekly@newsletter.com" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "campaign@marketing.org" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "notifications@example.com" }),
        }),
        logger,
      ),
    ).toBe(true);
  });

  it("should trim whitespace from patterns with comma separator", () => {
    const rule = getStaticRule({
      from: "  @company1.com  ,   @company2.com  ,  @company3.com  ",
    });

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "user@company1.com" }),
        }),
        logger,
      ),
    ).toBe(true);

    expect(
      matchesStaticRule(
        rule,
        getMessage({
          headers: getHeaders({ from: "user@company2.com" }),
        }),
        logger,
      ),
    ).toBe(true);
  });

  it("should not treat comma as separator in subject field", () => {
    const rule = getStaticRule({
      subject: "Option A, Option B, Option C",
    });

    const message1 = getMessage({
      headers: getHeaders({ subject: "Option A, Option B, Option C" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ subject: "Option A" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(false);
  });

  it("should not treat OR as separator in subject field", () => {
    const rule = getStaticRule({
      subject: "Status: Active OR Pending",
    });

    const message1 = getMessage({
      headers: getHeaders({ subject: "Status: Active OR Pending" }),
    });
    expect(matchesStaticRule(rule, message1, logger)).toBe(true);

    const message2 = getMessage({
      headers: getHeaders({ subject: "Status: Active" }),
    });
    expect(matchesStaticRule(rule, message2, logger)).toBe(false);
  });
});
