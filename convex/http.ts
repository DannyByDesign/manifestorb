import Stripe from "stripe";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeKey || !webhookSecret) {
      return new Response("Stripe env not configured", { status: 500 });
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    const payload = await request.text();

    const stripe = new Stripe(stripeKey, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        payload,
        signature,
        webhookSecret,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`Webhook signature verification failed: ${message}`, {
        status: 400,
      });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = session.metadata?.subscriptionId;
      if (subscriptionId) {
        try {
          await ctx.runMutation(internal.payment.markPaid, {
            subscriptionId: subscriptionId as Id<"subscriptions">,
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id,
            stripeCustomerId:
              typeof session.customer === "string"
                ? session.customer
                : (session.customer?.id ?? undefined),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`markPaid failed for ${subscriptionId}: ${message}`);
        }
      }
    }

    return new Response(null, { status: 200 });
  }),
});

export default http;
