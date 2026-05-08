import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { cadence as cadenceValidator } from "./schema";

export const createSignup = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    ageAtSignup: v.number(),
    currentSelf: v.string(),
    futureSelf: v.string(),
    whatMatters: v.string(),
    hardestPart: v.string(),
    normalTuesday: v.string(),
    hardDayMessage: v.string(),
    cadence: cadenceValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      ageAtSignup: args.ageAtSignup,
      status: "pending_payment",
      createdAt: now,
    });

    await ctx.db.insert("profiles", {
      userId,
      currentSelf: args.currentSelf,
      futureSelf: args.futureSelf,
      whatMatters: args.whatMatters,
      hardestPart: args.hardestPart,
      normalTuesday: args.normalTuesday,
      hardDayMessage: args.hardDayMessage,
    });

    const { cadenceDays, totalLetters, amountPaidCents } = pricingFor(args.cadence);

    const subscriptionId = await ctx.db.insert("subscriptions", {
      userId,
      cadence: args.cadence,
      cadenceDays,
      totalLetters,
      startDate: 0,
      endDate: 0,
      amountPaidCents,
      currency: "usd",
      status: "pending",
    });

    return { userId, subscriptionId };
  },
});

function pricingFor(cadence: "monthly" | "biweekly" | "weekly") {
  switch (cadence) {
    case "weekly":
      return { cadenceDays: 7, totalLetters: 260, amountPaidCents: 1200 };
    case "biweekly":
      return { cadenceDays: 14, totalLetters: 130, amountPaidCents: 800 };
    case "monthly":
      return { cadenceDays: 30, totalLetters: 60, amountPaidCents: 300 };
  }
}
