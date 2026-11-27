# BUILD_STATE

## Architecture decisions

| Decision | Why |
| --- | --- |
| One venue aggregate (JSON) per venue, written by compare-and-set on a revision | Gives atomic, serialisable transitions with a tiny surface. The pure domain re-validates on every retry. |
| Upstash Redis (Vercel Marketplace) instead of Supabase | The Supabase account hit its 2-free-project limit, and both existing projects were hibernating and could not be paused. `supabase/migrations/0001_chronos.sql` records the equivalent Postgres design (RLS on, no public policies) but is **not used or verified**. |
| Polling (1s) instead of a realtime channel | Simple and reliable across serverless instances. |
| Stripe Checkout for priority; manual-capture Checkout for orders | Hosted card entry, a server-calculated amount, and metadata linking sessions to exchanges. |
| Reservation TTL 15 min, explicitly expiring Stripe sessions | Stripe sessions must live ≥30 min, so CHRONOS expires them itself and releases positions only after Stripe confirms expiry. |
| Simulation adapter when no Stripe key is set | Same lifecycle and reconciliation path, clearly labelled in the UI. No money moves. |
| `SESSION_SECRET` set separately for Production and Preview | Merchant sign-in requires it outside local dev. |
| Merchant passcode defaults to the public `chronos-demo` | This is a portfolio demo. Set `MERCHANT_PASSCODE` for a private deployment. |

## Done (verified)

- Domain engine and its tests: premium calculation, compensation conservation, consent refusal, cumulative delay, minimum-charge limit, payment minimum, stale and expired quotes, serving conflict, concurrent-exchange conflict, duplicate finalization, failed payment, late-payment refund, discounted final charge.
- Lifecycle tests on a memory store with a simulated adapter and a Stripe-like fake: duplicate webhook events, return-page reconciles, concurrent purchases (exactly one reserves), checkout-creation failure, abandoned-checkout expiry, late payment refunded, cancel honouring a payment that already succeeded, and discounted capture on serving.
- Public-demo robustness: idle re-seed after 10 minutes (not while a payment is pending), a second visitor can still buy after the first exchange, "Join again" after being served.
- `npm test`: 38/38 passing. Lint, typecheck and production build are clean.
- Customer app: join with name, order and consent, editable consent settings, price options for each spot, a 60s quote lock, simulated checkout, receipts, order summary with earned discounts, leaving the queue.
- Live display with QR join. Merchant console with sign-in, call/finish, pending exchanges (check, cancel), money trail with per-exchange reconciliation, totals, finished orders with capture details.
- Deployed to Vercel with Upstash Redis. Cross-device sync verified on the live URL.

## Implemented but not verified end to end

- **Stripe sandbox path** (priority Checkout, webhook, order manual capture). The code is written and the logic is covered by the Stripe-like fake in the tests. It has not yet run against real Stripe test keys, because none are configured. When verifying, check:
  - Checkout no longer pins `payment_method_types`, so it offers whatever methods the Stripe dashboard enables. Confirm the "complete but unpaid" (async payment) case releases correctly.
  - Register the webhook endpoint `/api/stripe/webhook` for `checkout.session.*` events and set `STRIPE_WEBHOOK_SECRET`.
  - Confirm a real $10.00 authorization captures at the discounted amount.

## Pending

- Add Stripe test keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) and verify a real sandbox purchase and a discounted capture.
- Optional: rate limiting on public endpoints, and multiple venues (the engine already supports any venue id).
