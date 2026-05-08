import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 60 * 60 * 1000;
const BATCH_LIMIT = 200;

export const listDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("letters")
      .withIndex("by_status_scheduledFor", (q) =>
        q.eq("status", "scheduled").lte("scheduledFor", now),
      )
      .take(BATCH_LIMIT);
    return due.map((l) => l._id);
  },
});

export const processDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids = await ctx.runQuery(internal.letters.listDue, {});
    for (const id of ids) {
      await ctx.scheduler.runAfter(0, internal.lettersNode.sendOne, {
        letterId: id,
      });
    }
  },
});

export const claimForGeneration = internalMutation({
  args: { letterId: v.id("letters") },
  handler: async (ctx, args) => {
    const letter = await ctx.db.get(args.letterId);
    if (!letter || letter.status !== "scheduled") return false;
    await ctx.db.patch(args.letterId, { status: "generating" });
    return true;
  },
});

export const loadSendContext = internalQuery({
  args: { letterId: v.id("letters") },
  handler: async (ctx, args) => {
    const letter = await ctx.db.get(args.letterId);
    if (!letter) return null;

    const user = await ctx.db.get(letter.userId);
    const subscription = await ctx.db.get(letter.subscriptionId);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", letter.userId))
      .unique();

    const recent = await ctx.db
      .query("letters")
      .withIndex("by_userId_weekNumber", (q) =>
        q.eq("userId", letter.userId).lt("weekNumber", letter.weekNumber),
      )
      .order("desc")
      .take(20);

    const sentRecent = recent.filter((l) => l.status === "sent").slice(0, 5);

    return { letter, user, subscription, profile, recentSummaries: sentRecent };
  },
});

export const finalizeSent = internalMutation({
  args: {
    letterId: v.id("letters"),
    subject: v.string(),
    bodyMarkdown: v.string(),
    bodyHtml: v.string(),
    summary: v.string(),
    resendMessageId: v.string(),
    llmModel: v.string(),
    tokensInput: v.number(),
    tokensOutput: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.letterId, {
      status: "sent",
      sentAt: Date.now(),
      subject: args.subject,
      bodyMarkdown: args.bodyMarkdown,
      bodyHtml: args.bodyHtml,
      summary: args.summary,
      resendMessageId: args.resendMessageId,
      llmModel: args.llmModel,
      tokensInput: args.tokensInput,
      tokensOutput: args.tokensOutput,
    });
  },
});

export const recordFailure = internalMutation({
  args: { letterId: v.id("letters"), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const letter = await ctx.db.get(args.letterId);
    if (!letter) return;
    const nextRetry = letter.retryCount + 1;
    if (nextRetry < MAX_RETRIES) {
      await ctx.db.patch(args.letterId, {
        status: "scheduled",
        scheduledFor: Date.now() + RETRY_DELAY_MS,
        retryCount: nextRetry,
        errorMessage: args.errorMessage,
      });
    } else {
      await ctx.db.patch(args.letterId, {
        status: "failed",
        retryCount: nextRetry,
        errorMessage: args.errorMessage,
      });
    }
  },
});
