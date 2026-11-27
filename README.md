# CHRONOS — Time is currency

Consent-based time exchange. Customers buy queue priority; customers who agree to wait longer get exact discounts.

    npm install
    npm run dev    # http://localhost:3000

Demo: **Join as Daniel → "→ #1" → Pay $1.75**. Queue rearranges, Alice/Bob/Charlie get $0.50/$0.75/$0.25 off, merchant nets $0.25.
"Serve next" then "Complete & capture" shows the discounted final charge. "Reset demo" restores the seed.

- `src/domain/` — pure pricing and exchange engine (integer cents, consent, delay caps, minimum charge, stale or expired quote rejection, exactly-once finalization). Tests: `npm test`.
- Payments are a **labelled simulation**, so no real money moves. Stripe and Supabase are not wired up in this build.
