import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { arcPhase, letterTone, sourceField } from "./schema";

const FIRST_LETTER_DELAY_MS = 2 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const planEntry = v.object({
  theme: v.string(),
  angle: v.string(),
  tone: letterTone,
  sourceField,
  arcPhase,
});

export const loadPlanContext = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (!subscription) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", subscription.userId))
      .unique();
    const user = await ctx.db.get(subscription.userId);
    return { subscription, profile, user };
  },
});

export const createLettersFromPlan = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    plan: v.array(planEntry),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found");

    const existing = await ctx.db
      .query("letters")
      .withIndex("by_subscriptionId", (q) => q.eq("subscriptionId", args.subscriptionId))
      .first();
    if (existing) return { skipped: true };

    if (args.plan.length !== sub.totalLetters) {
      throw new Error(
        `Plan has ${args.plan.length} entries, expected ${sub.totalLetters}`,
      );
    }

    for (let i = 0; i < args.plan.length; i++) {
      const entry = args.plan[i];
      const scheduledFor =
        i === 0
          ? sub.startDate + FIRST_LETTER_DELAY_MS
          : sub.startDate + i * sub.cadenceDays * MS_PER_DAY;

      await ctx.db.insert("letters", {
        userId: sub.userId,
        subscriptionId: args.subscriptionId,
        weekNumber: i + 1,
        scheduledFor,
        status: "scheduled",
        plannedTheme: entry.theme,
        plannedAngle: entry.angle,
        plannedTone: entry.tone,
        sourceField: entry.sourceField,
        arcPhase: entry.arcPhase,
        retryCount: 0,
      });
    }

    return { skipped: false };
  },
});
