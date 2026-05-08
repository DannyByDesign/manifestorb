import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const cadence = v.union(
  v.literal("monthly"),
  v.literal("biweekly"),
  v.literal("weekly"),
);

export const userStatus = v.union(
  v.literal("pending_payment"),
  v.literal("active"),
  v.literal("completed"),
);

export const subscriptionStatus = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("completed"),
);

export const letterStatus = v.union(
  v.literal("scheduled"),
  v.literal("generating"),
  v.literal("sent"),
  v.literal("failed"),
);

export const sourceField = v.union(
  v.literal("currentSelf"),
  v.literal("futureSelf"),
  v.literal("whatMatters"),
  v.literal("hardestPart"),
  v.literal("normalTuesday"),
  v.literal("hardDayMessage"),
);

export const letterTone = v.union(
  v.literal("quiet"),
  v.literal("celebratory"),
  v.literal("warning"),
  v.literal("dreaming"),
  v.literal("mundane"),
  v.literal("tender"),
  v.literal("blunt"),
  v.literal("playful"),
  v.literal("reverent"),
  v.literal("conspiratorial"),
  v.literal("wry"),
  v.literal("grieving"),
  v.literal("matter-of-fact"),
);

export const arcPhase = v.union(
  v.literal("year-1-footing"),
  v.literal("year-2-build"),
  v.literal("year-3-thick"),
  v.literal("year-4-emerging"),
  v.literal("year-5-arrived"),
);

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    ageAtSignup: v.number(),
    status: userStatus,
    stripeCustomerId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  profiles: defineTable({
    userId: v.id("users"),
    currentSelf: v.string(),
    futureSelf: v.string(),
    whatMatters: v.string(),
    hardestPart: v.string(),
    normalTuesday: v.string(),
    hardDayMessage: v.string(),
  }).index("by_userId", ["userId"]),

  subscriptions: defineTable({
    userId: v.id("users"),
    cadence: cadence,
    cadenceDays: v.number(),
    totalLetters: v.number(),
    startDate: v.number(),
    endDate: v.number(),
    amountPaidCents: v.number(),
    currency: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    status: subscriptionStatus,
  })
    .index("by_userId", ["userId"])
    .index("by_stripeCheckoutSessionId", ["stripeCheckoutSessionId"]),

  letters: defineTable({
    userId: v.id("users"),
    subscriptionId: v.id("subscriptions"),
    weekNumber: v.number(),
    scheduledFor: v.number(),
    status: letterStatus,

    plannedTheme: v.string(),
    plannedAngle: v.string(),
    plannedTone: letterTone,
    sourceField: sourceField,
    arcPhase: arcPhase,

    subject: v.optional(v.string()),
    bodyMarkdown: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
    summary: v.optional(v.string()),

    sentAt: v.optional(v.number()),
    resendMessageId: v.optional(v.string()),

    llmModel: v.optional(v.string()),
    tokensInput: v.optional(v.number()),
    tokensOutput: v.optional(v.number()),

    errorMessage: v.optional(v.string()),
    retryCount: v.number(),
  })
    .index("by_status_scheduledFor", ["status", "scheduledFor"])
    .index("by_userId_weekNumber", ["userId", "weekNumber"])
    .index("by_subscriptionId", ["subscriptionId"]),
});
