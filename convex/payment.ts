import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const FIVE_YEARS_MS = Math.round(5 * 365.25 * 24 * 60 * 60 * 1000);

export const markPaid = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    stripeCheckoutSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found");

    if (sub.status === "active" || sub.status === "completed") {
      return { alreadyProcessed: true };
    }

    const now = Date.now();

    await ctx.db.patch(args.subscriptionId, {
      status: "active",
      startDate: now,
      endDate: now + FIVE_YEARS_MS,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
    });

    await ctx.db.patch(sub.userId, {
      status: "active",
      ...(args.stripeCustomerId ? { stripeCustomerId: args.stripeCustomerId } : {}),
    });

    await ctx.scheduler.runAfter(0, internal.planningNode.generatePlan, {
      subscriptionId: args.subscriptionId,
    });

    return { alreadyProcessed: false };
  },
});
