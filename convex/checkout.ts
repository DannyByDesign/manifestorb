import Stripe from "stripe";
import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const PRODUCT_LABELS: Record<"weekly" | "biweekly" | "monthly", string> = {
  weekly: "ManifestOrb — weekly letters (5 years)",
  biweekly: "ManifestOrb — biweekly letters (5 years)",
  monthly: "ManifestOrb — monthly letters (5 years)",
};

export const getSubscriptionForCheckout = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) return null;
    const user = await ctx.db.get(sub.userId);
    if (!user) return null;
    return {
      cadence: sub.cadence,
      amountPaidCents: sub.amountPaidCents,
      currency: sub.currency,
      status: sub.status,
      email: user.email,
    };
  },
});

export const createCheckoutSession = action({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const sub = await ctx.runQuery(internal.checkout.getSubscriptionForCheckout, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub) throw new Error("Subscription not found");
    if (sub.status !== "pending") {
      throw new Error("Subscription is not awaiting payment");
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set in Convex env");
    const baseUrl = process.env.PUBLIC_BASE_URL;
    if (!baseUrl) throw new Error("PUBLIC_BASE_URL not set in Convex env");

    const stripe = new Stripe(stripeKey, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: sub.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: sub.currency,
            unit_amount: sub.amountPaidCents,
            product_data: {
              name: PRODUCT_LABELS[sub.cadence],
              description:
                "A series of letters from your future self, delivered for the next five years.",
            },
          },
        },
      ],
      metadata: {
        subscriptionId: args.subscriptionId,
      },
      payment_intent_data: {
        metadata: {
          subscriptionId: args.subscriptionId,
        },
      },
      success_url: `${baseUrl.replace(/\/$/, "")}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl.replace(/\/$/, "")}/cancel`,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }
    return { url: session.url };
  },
});
