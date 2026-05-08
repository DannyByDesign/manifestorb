# ManifestOrb — setup

End-to-end setup to take a fresh clone to a working production-ready deploy.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2 (this repo enforces `bun` via `packageManager`; do
  not use npm/yarn/pnpm).
- A Convex account (https://convex.dev).
- A Stripe account (https://dashboard.stripe.com).
- A Resend account (https://resend.com) with a verified domain.
- An Anthropic API key (https://console.anthropic.com).

## 1. Install

```bash
bun install
```

## 2. Provision Convex

From the project root, run:

```bash
bun run convex:dev
```

This will:
1. Prompt you to log in to Convex (browser flow).
2. Ask you to choose / create a project.
3. Generate `convex/_generated/` (committed `.gitignore` excludes it; local-only).
4. Print your deployment URL — copy it.

Leave `bun run convex:dev` running. It re-deploys functions on file save.

## 3. Set Convex environment variables

Set each of the following with `bunx convex env set <KEY> <VALUE>` (you can also
do this in the Convex dashboard at Settings → Environment Variables).

| Key                   | Example                                              | Notes                                                                                          |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`   | `sk-ant-api03-…`                                     | Used by the planner (Haiku 4.5) and writer.                                                    |
| `STRIPE_SECRET_KEY`   | `sk_test_…` (test) / `sk_live_…` (prod)              | Server secret key from Stripe → Developers → API keys.                                         |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`                                          | **Per-endpoint.** You'll get one for local CLI forwarding and a different one for the prod endpoint — see step 5. |
| `RESEND_API_KEY`      | `re_…`                                               | Resend → API Keys.                                                                             |
| `RESEND_FROM_EMAIL`   | `future@manifestorb.com`                             | Must be on a domain you've verified in Resend (SPF/DKIM/DMARC). Bare email — display name is added at send time. |
| `PUBLIC_BASE_URL`     | `http://localhost:3000` (dev) / `https://manifestorb.com` (prod) | Used to construct Stripe success/cancel URLs.                                                  |

Example commands:

```bash
bunx convex env set ANTHROPIC_API_KEY sk-ant-api03-...
bunx convex env set STRIPE_SECRET_KEY sk_test_...
bunx convex env set STRIPE_WEBHOOK_SECRET whsec_...
bunx convex env set RESEND_API_KEY re_...
bunx convex env set RESEND_FROM_EMAIL future@manifestorb.com
bunx convex env set PUBLIC_BASE_URL http://localhost:3000
```

## 4. Set Next.js environment variables

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
```

You can find the URL in `bun run convex:dev` output, or in the Convex dashboard.

## 5. Wire up Stripe webhooks

The webhook endpoint is exposed at:

```
<convex-http-url>/stripe/webhook
```

Where `<convex-http-url>` is your deployment's HTTP actions URL. It looks like
`https://<deployment-name>.convex.site` (note `.convex.site`, not `.convex.cloud`).
You can read it from the Convex dashboard or from `bun run convex:dev` output.

### Local development

Use the Stripe CLI to forward live webhook events to your local Convex
deployment:

```bash
stripe listen --forward-to <convex-http-url>/stripe/webhook
```

The CLI will print a `whsec_…` signing secret. Use **that** as
`STRIPE_WEBHOOK_SECRET` for local dev:

```bash
bunx convex env set STRIPE_WEBHOOK_SECRET whsec_<from-stripe-cli>
```

### Production

In the Stripe dashboard → Developers → Webhooks → Add endpoint:

- **Endpoint URL:** `<prod-convex-http-url>/stripe/webhook`
- **Events to send:** `checkout.session.completed`

After creating the endpoint, click "Reveal signing secret" and copy it. That is
your **prod** `STRIPE_WEBHOOK_SECRET` — set it on your production Convex
deployment (not the dev one):

```bash
bunx convex env set STRIPE_WEBHOOK_SECRET whsec_<from-prod-endpoint> --prod
```

## 6. Verify your Resend domain

1. In Resend → Domains, add the domain you want to send from (e.g.
   `manifestorb.com`).
2. Add the SPF, DKIM, and DMARC DNS records Resend gives you to your DNS
   provider.
3. Wait for verification. **DNS propagation can take a few minutes to several
   hours.** Until verification completes, every send will fail with a "domain
   not verified" error from Resend.
4. Set `RESEND_FROM_EMAIL` to any address on that domain (e.g.
   `future@manifestorb.com`).

## 7. Run the app

In a second terminal (with `bun run convex:dev` still running in the first):

```bash
bun run dev
```

Open http://localhost:3000 and walk through the questionnaire. On Seal-it you'll
be redirected to Stripe Checkout. Use Stripe's test card `4242 4242 4242 4242`
with any future expiry and any CVC. After payment, you'll bounce back to
`/success` and the webhook will trigger plan generation in Convex. The first
letter is scheduled to send 2 minutes after payment; subsequent letters follow
the cadence you picked (weekly / biweekly / monthly).

## Going to production

```bash
bun run convex:deploy   # deploys convex functions to prod
bun run build           # builds Next.js
bun start               # serves the production build
```

Make sure all 6 environment variables (5 Convex + 1 Next.js) are set against
your production deployments — and that the Stripe webhook endpoint is
configured against the prod Convex URL.

## Troubleshooting

- **`Webhook signature verification failed`** — check that you copied the
  signing secret from the right place: the Stripe CLI prints one for `stripe
  listen`, and the Stripe dashboard has a separate one per endpoint. Each must
  match `STRIPE_WEBHOOK_SECRET` on the corresponding Convex deployment.
- **`domain not verified` from Resend** — DNS hasn't propagated yet. Recheck the
  DNS records and wait. You can `dig TXT <subdomain>` to verify.
- **Plan never generates after payment** — confirm the webhook fired in the
  Stripe dashboard (Developers → Webhooks → your endpoint → Recent events) and
  that the Convex function logs show `markPaid` ran. If markPaid ran but no
  letters were inserted, check the `generatePlan` action logs in Convex.
- **`ANTHROPIC_API_KEY not set in Convex env`** — `bunx convex env list` to
  audit what's actually set on your deployment.
