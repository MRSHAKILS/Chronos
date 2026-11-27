# CHRONOS: time is currency

**Live demo:** https://chronos-time-exchange.vercel.app

CHRONOS is a consent-based time exchange for queues. Customers in a hurry buy a faster spot. Customers who agreed in advance to be passed get paid for the extra wait, as a discount on their order. A café is the demo setting, but the engine knows nothing about coffee. It works for any service queue, such as clinics, counters or pickups.

> Daniel is 4th in line and pays **$1.75** to go 1st. Alice gets **$0.50** off, Bob **$0.75**, Charlie **$0.25**, and the café keeps a **$0.25** fee.
> Premium = Σ compensation + merchant fee, for every exchange, in integer cents.

| Screen | Path | Who uses it |
| --- | --- | --- |
| Customer | `/customer` | Mobile. Join, set your consent, buy priority, see receipts and your final bill. |
| Live queue | `/display` | Big screen. Animated queue, compensation paid, café revenue, QR code to join. |
| Café console | `/merchant` | Staff, behind a passcode. Serve customers, capture discounted orders, review the money trail and reconciliation. Public demo passcode: `chronos-demo`. |

## How it works

1. **Consent first.** Each customer chooses whether they can be passed, their price per pass and the most extra waiting they'll accept in total. Nobody is ever passed without agreeing.
2. **Transparent quotes.** The server prices every possible move: who is passed, what each person gets, how much time each side gains or loses, and the café fee. A quote is tied to a queue version and expires after 60 seconds.
3. **Reserve, pay, then apply.** Accepting a quote atomically reserves the people involved. Payment is confirmed from the provider's own record, never from a redirect. Only then does the queue move, exactly once.
4. **Discounts flow into the bill.** When an order is served, the final discounted amount is captured, for example $10.00 authorized and $9.50 captured.

## Engineering highlights

- **Pure, tested domain engine** (`src/domain`). Queue, quote, exchange lifecycle and reconciliation are pure functions over one venue aggregate, with no I/O. All money is integer cents.
- **Rejection rules.** Exchanges are refused when consent is missing, the cumulative delay limit would be exceeded, a discount would breach the order's minimum charge, the quote is stale or expired, someone involved is already being served, or a conflicting exchange is pending.
- **Atomic writes without long transactions.** Each state change is read → pure transition → compare-and-set on a revision number. In production that is a Lua script on Upstash Redis. If two writes collide, the change is re-validated and retried. No transaction stays open during a call to the payment provider.
- **Idempotent payment lifecycle** (`src/server/lifecycle.ts`). Webhooks, return pages and a background sweep all go through one `reconcileExchange` path:
  - Duplicate Stripe events are deduplicated by event id.
  - Abandoned checkouts are expired, and their reservations released, only after the provider confirms they can no longer be paid.
  - A payment that lands after its reservation was released is refunded in full and recorded.
- **Two payment adapters, one lifecycle.** The live demo runs the simulation adapter. The Stripe sandbox adapter uses Checkout for priority and manual capture for orders, and refuses live keys at startup. When no keys are set, an explicitly labelled simulation adapter runs the identical state machine.
- **Security.**
  - Customer sessions are random tokens in httpOnly cookies. Only their SHA-256 hash is stored.
  - The merchant console uses an HMAC-signed, expiring cookie.
  - All input is validated with Zod.
  - Public responses are stripped of private data.
  - Secrets never reach the browser.
- **Self-healing public demo.** The venue re-seeds after 10 idle minutes (never while a payment is pending), and served customers can join again.
- **Live everywhere.** Every screen polls the sanitised state each second, so a phone, the projector and the till stay in sync.

## Tech

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS 4 · Motion · Lucide · Zod · Stripe SDK · Upstash Redis (via Vercel Marketplace) · Vitest · deployed on Vercel.

```
src/domain/     pure engine: money, queue, quote, exchange, reconcile (no I/O)
src/server/     store (Redis / memory CAS), payment adapters, lifecycle, auth, runtime wiring
src/app/api/    state · customer · merchant · stripe/webhook route handlers
src/components/ customer app, live queue, merchant console
tests/          domain + lifecycle tests (38)
```

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000, in-memory store + simulated payments
npm test           # 38 tests
npm run lint && npm run typecheck && npm run build
```

Copy `.env.example` to `.env.local` to enable shared Redis state or the Stripe sandbox. For Stripe webhooks locally:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Test card: `4242 4242 4242 4242`, any future expiry, any CVC.

## Status

See [BUILD_STATE.md](BUILD_STATE.md) for architecture decisions, what is done and what is not.
