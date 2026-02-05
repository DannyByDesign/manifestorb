import { describe, it, expect, vi } from "vitest";
import {
  aiCategorizeSenders,
  REQUEST_MORE_INFORMATION_CATEGORY,
} from "@/features/categorize/ai/ai-categorize-senders";
import { defaultCategory } from "@/server/lib/categories";
import { aiCategorizeSender } from "@/features/categorize/ai/ai-categorize-single-sender";
import { getEmailAccount } from "@/__tests__/helpers";

// bun test-ai ai-categorize-senders

const isAiTest = process.env.RUN_AI_TESTS === "true";

const TIMEOUT = 15_000;

vi.mock("server-only", () => ({}));

const emailAccount = getEmailAccount();

const testSenders = [
  {
    emailAddress: "colleague@test.com",
    emails: [
      { subject: "Project update for Q2 roadmap", snippet: "" },
    ],
    expectedCategory: "Internal",
  },
  {
    emailAddress: "calendar@service.com",
    emails: [{ subject: "Meeting request for next week", snippet: "" }],
    expectedCategory: "Scheduling",
  },
  {
    emailAddress: "billing@vendor.com",
    emails: [{ subject: "Invoice #123 for February", snippet: "" }],
    expectedCategory: "Finance",
  },
  {
    emailAddress: "updates@service.com",
    emails: [{ subject: "Weekly status update", snippet: "" }],
    expectedCategory: "Updates",
  },
  {
    emailAddress: "marketing@business.com",
    emails: [
      { subject: "Special offer: 20% off our enterprise plan", snippet: "" },
    ],
    expectedCategory: "Marketing",
  },
  {
    emailAddress: "alex@gmail.com",
    emails: [{ subject: "Dinner plans this weekend?", snippet: "" }],
    expectedCategory: "External People",
  },
  {
    emailAddress: "client@partner.com",
    emails: [{ subject: "Can you review the proposal?", snippet: "" }],
    expectedCategory: "Action Required",
  },
  {
    emailAddress: "unknown@example.com",
    emails: [],
    expectedCategory: "Other",
  },
];

describe.runIf(isAiTest)("AI Sender Categorization", () => {
  describe("Bulk Categorization", () => {
    it(
      "should categorize senders with snippets using AI",
      async () => {
        const result = await aiCategorizeSenders({
          emailAccount,
          senders: testSenders,
          categories: getEnabledCategories(),
        });

        expect(result).toHaveLength(testSenders.length);

        // Internal
        const internalResult = result.find(
          (r) => r.sender === "colleague@test.com",
        );
        expect(internalResult?.category).toBe("Internal");

        // Scheduling
        const schedulingResult = result.find(
          (r) => r.sender === "calendar@service.com",
        );
        expect(schedulingResult?.category).toBe("Scheduling");

        // Finance
        const financeResult = result.find(
          (r) => r.sender === "billing@vendor.com",
        );
        expect(financeResult?.category).toBe("Finance");

        // Marketing
        const marketingResult = result.find(
          (r) => r.sender === "marketing@business.com",
        );
        expect(marketingResult?.category).toBe("Marketing");
      },
      TIMEOUT,
    );

    it("should handle empty senders list", async () => {
      const result = await aiCategorizeSenders({
        emailAccount,
        senders: [],
        categories: [],
      });

      expect(result).toEqual([]);
    });

    it(
      "should categorize senders for all valid SenderCategory values",
      async () => {
        const examples: Record<
          string,
          { sender: string; subject: string; snippet?: string }
        > = {
          "Action Required": {
            sender: "client@partner.com",
            subject: "Action required: please review",
          },
          Scheduling: {
            sender: "calendar@service.com",
            subject: "Schedule a meeting next week",
          },
          Finance: {
            sender: "billing@vendor.com",
            subject: "Invoice #123 for February",
          },
          Updates: {
            sender: "updates@service.com",
            subject: "Weekly status update",
          },
          Marketing: {
            sender: "marketing@business.com",
            subject: "Special offer just for you",
          },
          Internal: {
            sender: "colleague@test.com",
            subject: "Internal update",
          },
          "External People": {
            sender: "alex@gmail.com",
            subject: "Dinner plans this weekend?",
          },
        };

        const enabledCategories = getEnabledCategories().filter(
          (category) => category.name !== "Other",
        );
        const senders = enabledCategories.map((category) => {
          const example = examples[category.name];
          if (!example) {
            throw new Error(`Missing example for category: ${category.name}`);
          }
          return {
            emailAddress: example.sender,
            emails: [{ subject: example.subject, snippet: example.snippet ?? "" }],
          };
        });

        const result = await aiCategorizeSenders({
          emailAccount,
          senders,
          categories: getEnabledCategories(),
        });

        expect(result).toHaveLength(senders.length);

        for (const category of enabledCategories) {
          const example = examples[category.name];
          const senderResult = result.find(
            (r) => r.sender === example.sender,
          );
          expect(senderResult).toBeDefined();
          expect(senderResult?.category).toBe(category.name);
        }
      },
      TIMEOUT,
    );
  });

  describe("Single Sender Categorization", () => {
    it(
      "should categorize individual senders with snippets",
      async () => {
        for (const { emailAddress, emails, expectedCategory } of testSenders) {
          const result = await aiCategorizeSender({
            emailAccount,
            sender: emailAddress,
            previousEmails: emails,
            categories: getEnabledCategories(),
          });

          if (expectedCategory === "Other") {
            expect([REQUEST_MORE_INFORMATION_CATEGORY, "Other"]).toContain(
              result?.category,
            );
          } else {
            expect(result?.category).toBe(expectedCategory);
          }
        }
      },
      TIMEOUT * 2,
    );

    it(
      "should handle unknown sender appropriately",
      async () => {
        const unknownSender = testSenders.find(
          (s) => s.expectedCategory === "Other",
        );
        if (!unknownSender) throw new Error("No other sender in test data");

        const result = await aiCategorizeSender({
          emailAccount,
          sender: unknownSender.emailAddress,
          previousEmails: [],
          categories: getEnabledCategories(),
        });

        expect([REQUEST_MORE_INFORMATION_CATEGORY, "Other"]).toContain(
          result?.category,
        );
      },
      TIMEOUT,
    );
  });

  describe("Comparison Tests", () => {
    it(
      "should produce consistent results between bulk and single categorization",
      async () => {
        // Run bulk categorization
        const bulkResults = await aiCategorizeSenders({
          emailAccount,
          senders: testSenders,
          categories: getEnabledCategories(),
        });

        // Run individual categorizations and pair with senders
        const singleResults = await Promise.all(
          testSenders.map(async ({ emailAddress, emails }) => {
            const result = await aiCategorizeSender({
              emailAccount,
              sender: emailAddress,
              previousEmails: emails,
              categories: getEnabledCategories(),
            });
            return {
              sender: emailAddress,
              category: result?.category,
            };
          }),
        );

        // Compare results for each sender
        for (const { emailAddress, expectedCategory } of testSenders) {
          const bulkResult = bulkResults.find((r) => r.sender === emailAddress);
          const singleResult = singleResults.find(
            (r) => r.sender === emailAddress,
          );

          // Both should either have a category or both be undefined
          if (bulkResult?.category || singleResult?.category) {
            expect(bulkResult?.category).toBeDefined();
            expect(singleResult?.category).toBeDefined();
            expect(bulkResult?.category).toBe(singleResult?.category);

            // If not Other, check against expected category
            if (expectedCategory !== "Other") {
              expect(bulkResult?.category).toBe(expectedCategory);
              expect(singleResult?.category).toBe(expectedCategory);
            }
          }
        }
      },
      TIMEOUT * 2,
    );
  });
});

const getEnabledCategories = () => {
  return Object.entries(defaultCategory)
    .filter(([_, value]) => value.enabled)
    .map(([_, value]) => ({
      name: value.name,
      description: value.description,
    }));
};
