import { describe, expect, it } from 'vitest'
import { finalizeExchange, recordLatePaymentRefund, releaseExchange, reserveExchange } from '@/domain/exchange'
import { ceilBps, formatCents } from '@/domain/money'
import { callNext, completeService, estimateWaits, leaveQueue, positionOf, updateConsent } from '@/domain/queue'
import { computeQuote, issueQuote, quoteLadder } from '@/domain/quote'
import { reconcileExchanges, venueTotals } from '@/domain/reconcile'
import type { VenueState } from '@/domain/types'
import { T0, demoState, join, seqIds, unwrap } from './helpers'

const evidence = (amountCents: number, sessionId = 'sess_1') => ({
  provider: 'simulated' as const,
  amountCents,
  currency: 'usd',
  sessionId,
})

function quoteAndReserve(state: VenueState, target = 1) {
  const ids = seqIds()
  const { state: s1, quote } = unwrap(issueQuote(state, 'daniel', target, T0, ids))
  const { state: s2, exchange } = unwrap(
    reserveExchange(s1, { quoteId: quote.id, requesterId: 'daniel', provider: 'simulated' }, T0 + 1000, ids),
  )
  return { state: s2, exchange, quote, ids }
}

describe('money', () => {
  it('formats integer cents and rounds basis points up with integer math', () => {
    expect(formatCents(175)).toBe('$1.75')
    expect(formatCents(5)).toBe('$0.05')
    expect(ceilBps(1001, 5000)).toBe(501)
    expect(() => formatCents(1.5)).toThrow()
  })
})

describe('priority quote', () => {
  it('prices the canonical example: Daniel #4 → #1 costs $1.75', () => {
    const q = unwrap(computeQuote(demoState(), 'daniel', 1, T0, 'q1'))
    expect(q.fromPosition).toBe(4)
    expect(q.targetPosition).toBe(1)
    expect(q.affected.map((a) => [a.displayName, a.compensationCents])).toEqual([
      ['Alice', 50],
      ['Bob', 75],
      ['Charlie', 25],
    ])
    expect(q.compensationTotalCents).toBe(150)
    expect(q.merchantFeeCents).toBe(25)
    expect(q.totalCents).toBe(175)
    expect(q.queueVersion).toBe(demoState().queueVersion)
    expect(q.expiresAt).toBe(T0 + 60_000)
  })

  it('reports time saved and the additional delay imposed on each affected customer', () => {
    const q = unwrap(computeQuote(demoState(), 'daniel', 1, T0, 'q1'))
    expect(q.timeSavedSec).toBe(180 + 240 + 120)
    for (const a of q.affected) {
      expect(a.additionalDelaySec).toBe(150) // Daniel's cold brew service time
      expect(a.cumulativeDelayAfterSec).toBe(150)
    }
    expect(q.affected.map((a) => a.orderTotalAfterCents)).toEqual([950, 1125, 575])
  })

  it('conserves money: premium = Σ compensation + merchant fee for every target', () => {
    for (const step of quoteLadder(demoState(), 'daniel', T0)) {
      expect(step.available).toBe(true)
      if (!step.available) continue
      const sum = step.quote.affected.reduce((s, a) => s + a.compensationCents, 0)
      expect(step.quote.totalCents).toBe(sum + step.quote.merchantFeeCents)
      expect(Number.isSafeInteger(step.quote.totalCents)).toBe(true)
    }
  })

  it('prices partial moves: #4 → #3 only overtakes Charlie', () => {
    const q = unwrap(computeQuote(demoState(), 'daniel', 3, T0, 'q'))
    expect(q.affected.map((a) => a.partyId)).toEqual(['charlie'])
    expect(q.totalCents).toBe(50)
  })

  it('refuses to overtake a customer who has not consented', () => {
    let s = demoState()
    s = unwrap(updateConsent(s, 'bob', { optIn: false, minCompensationCents: 75, maxAdditionalDelaySec: 360 }, T0)).state
    const r = computeQuote(s, 'daniel', 1, T0, 'q')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ code: 'not_consented', partyId: 'bob' })
    // Overtaking only Charlie is still possible.
    expect(computeQuote(s, 'daniel', 3, T0, 'q').ok).toBe(true)
  })

  it('enforces maximum cumulative additional delay', () => {
    let s = demoState()
    s = unwrap(updateConsent(s, 'alice', { optIn: true, minCompensationCents: 50, maxAdditionalDelaySec: 149 }, T0)).state
    const r = computeQuote(s, 'daniel', 1, T0, 'q')
    expect(!r.ok && r.error.code).toBe('delay_exceeded')

    // Cumulative: after one confirmed displacement, Charlie (max 240s) cannot absorb a second 150s delay.
    const { state, exchange, ids } = quoteAndReserve(demoState(), 3)
    const after = unwrap(finalizeExchange(state, exchange.id, evidence(50), T0 + 2000, ids)).state
    expect(after.parties.charlie!.addedDelaySec).toBe(150)
    expect(after.queue).toEqual(['alice', 'bob', 'daniel', 'charlie'])
    // Erin joins behind Charlie. Overtaking Charlie would add 120s → 270s cumulative > 240s allowed.
    const withErin = join(after, 'erin', 'espresso', { optIn: false, minCompensationCents: 50, maxAdditionalDelaySec: 0 })
    const r2 = computeQuote(withErin, 'erin', 4, T0 + 3000, 'q')
    expect(!r2.ok && r2.error).toMatchObject({ code: 'delay_exceeded', partyId: 'charlie' })
  })

  it('rejects compensation that would breach an order minimum charge', () => {
    let s = demoState()
    // Charlie's $6.00 espresso has a $3.00 minimum (50%). Asking $3.01 would breach it.
    s = unwrap(updateConsent(s, 'charlie', { optIn: true, minCompensationCents: 301, maxAdditionalDelaySec: 240 }, T0)).state
    const r = computeQuote(s, 'daniel', 3, T0, 'q')
    expect(!r.ok && r.error).toMatchObject({ code: 'below_min_charge', partyId: 'charlie' })
    s = unwrap(updateConsent(s, 'charlie', { optIn: true, minCompensationCents: 300, maxAdditionalDelaySec: 240 }, T0)).state
    expect(computeQuote(s, 'daniel', 3, T0, 'q').ok).toBe(true)
  })

  it('rejects quotes below the payment rail minimum', () => {
    let s = demoState()
    s = unwrap(updateConsent(s, 'charlie', { optIn: true, minCompensationCents: 0, maxAdditionalDelaySec: 240 }, T0)).state
    const r = computeQuote(s, 'daniel', 3, T0, 'q')
    expect(!r.ok && r.error.code).toBe('below_payment_minimum')
  })

  it('refuses to overtake a customer who is already being served', () => {
    const s = unwrap(callNext(demoState(), T0)).state
    const r = computeQuote(s, 'daniel', 1, T0, 'q')
    expect(!r.ok && r.error).toMatchObject({ code: 'party_serving', partyId: 'alice' })
    expect(computeQuote(s, 'daniel', 2, T0, 'q').ok).toBe(true)
  })

  it('rejects invalid targets', () => {
    const s = demoState()
    expect(computeQuote(s, 'daniel', 4, T0, 'q').ok).toBe(false)
    expect(computeQuote(s, 'daniel', 0, T0, 'q').ok).toBe(false)
    expect(computeQuote(s, 'alice', 1, T0, 'q').ok).toBe(false)
  })
})

describe('exchange reservation', () => {
  it('rejects a stale quote after the queue version changes', () => {
    const ids = seqIds()
    const { state, quote } = unwrap(issueQuote(demoState(), 'daniel', 1, T0, ids))
    const changed = unwrap(updateConsent(state, 'bob', { optIn: true, minCompensationCents: 80, maxAdditionalDelaySec: 360 }, T0)).state
    const r = reserveExchange(changed, { quoteId: quote.id, requesterId: 'daniel', provider: 'simulated' }, T0, ids)
    expect(!r.ok && r.error.code).toBe('stale_version')
  })

  it('rejects an expired quote', () => {
    const ids = seqIds()
    const { state, quote } = unwrap(issueQuote(demoState(), 'daniel', 1, T0, ids))
    const r = reserveExchange(state, { quoteId: quote.id, requesterId: 'daniel', provider: 'simulated' }, T0 + 60_001, ids)
    expect(!r.ok && r.error.code).toBe('quote_expired')
  })

  it('rejects a quote presented by someone other than its requester', () => {
    const ids = seqIds()
    const { state, quote } = unwrap(issueQuote(demoState(), 'daniel', 1, T0, ids))
    const r = reserveExchange(state, { quoteId: quote.id, requesterId: 'charlie', provider: 'simulated' }, T0, ids)
    expect(!r.ok && r.error.code).toBe('quote_not_found')
  })

  it('locks affected parties and blocks a conflicting exchange', () => {
    const ids = seqIds()
    let s = demoState()
    // Two quotes issued against the same version: Daniel → #1 and Daniel → #3.
    const a = unwrap(issueQuote(s, 'daniel', 1, T0, ids))
    s = a.state
    const b = unwrap(issueQuote(s, 'daniel', 3, T0, ids))
    s = b.state
    s = unwrap(reserveExchange(s, { quoteId: a.quote.id, requesterId: 'daniel', provider: 'simulated' }, T0, ids)).state
    expect(s.parties.alice!.lockedBy).not.toBeNull()
    const second = reserveExchange(s, { quoteId: b.quote.id, requesterId: 'daniel', provider: 'simulated' }, T0, ids)
    expect(second.ok).toBe(false)
    // A newcomer cannot overtake reserved parties either.
    const r = computeQuote(s, 'daniel', 2, T0, 'q')
    expect(!r.ok && r.error.code).toBe('exchange_conflict')
  })

  it('snapshots each affected customer’s consent into the exchange record', () => {
    const { exchange } = quoteAndReserve(demoState())
    expect(exchange.quote.affected[1]!.consent).toMatchObject({ optIn: true, minCompensationCents: 75, maxAdditionalDelaySec: 360 })
  })

  it('freezes consent changes, leaving and serving for reserved parties', () => {
    const { state } = quoteAndReserve(demoState())
    expect(updateConsent(state, 'bob', { optIn: false, minCompensationCents: 75, maxAdditionalDelaySec: 360 }, T0).ok).toBe(false)
    expect(leaveQueue(state, 'alice', T0, seqIds()).ok).toBe(false)
    const r = callNext(state, T0)
    expect(!r.ok && r.error.code).toBe('locked_in_exchange')
  })
})

describe('exchange finalization', () => {
  it('applies a paid exchange: Daniel to #1, everyone else shifts back with exact discounts', () => {
    const { state, exchange, ids } = quoteAndReserve(demoState())
    const r = unwrap(finalizeExchange(state, exchange.id, evidence(175), T0 + 2000, ids))
    expect(r.applied).toBe(true)
    const s = r.state
    expect(s.queue).toEqual(['daniel', 'alice', 'bob', 'charlie'])
    expect(s.parties.alice!.earnedDiscountCents).toBe(50)
    expect(s.parties.bob!.earnedDiscountCents).toBe(75)
    expect(s.parties.charlie!.earnedDiscountCents).toBe(25)
    expect(Object.values(s.parties).every((p) => p.lockedBy === null)).toBe(true)
    const totals = venueTotals(s)
    expect(totals.premiumCollectedCents).toBe(175)
    expect(totals.compensationIssuedCents).toBe(150)
    expect(totals.merchantFeeRevenueCents).toBe(25)
    expect(reconcileExchanges(s).every((x) => x.balanced)).toBe(true)
  })

  it('applies exactly once when payment confirmation is delivered twice', () => {
    const { state, exchange, ids } = quoteAndReserve(demoState())
    const first = unwrap(finalizeExchange(state, exchange.id, evidence(175), T0 + 2000, ids))
    const second = unwrap(finalizeExchange(first.state, exchange.id, evidence(175), T0 + 3000, ids))
    expect(second.applied).toBe(false)
    expect(second.state).toBe(first.state)
    expect(second.state.parties.alice!.earnedDiscountCents).toBe(50)
    expect(second.state.ledger.filter((l) => l.kind === 'priority_premium')).toHaveLength(1)
  })

  it('rejects a payment for the wrong amount and leaves the queue untouched', () => {
    const { state, exchange, ids } = quoteAndReserve(demoState())
    const r = finalizeExchange(state, exchange.id, evidence(150), T0 + 2000, ids)
    expect(!r.ok && r.error.code).toBe('amount_mismatch')
    expect(state.queue).toEqual(['alice', 'bob', 'charlie', 'daniel'])
  })

  it('failed payment releases the reservation and leaves the queue unchanged', () => {
    const before = demoState()
    const { state, exchange } = quoteAndReserve(before)
    const r = unwrap(releaseExchange(state, exchange.id, 'payment_failed', T0 + 2000))
    expect(r.released).toBe(true)
    expect(r.state.queue).toEqual(before.queue)
    expect(Object.values(r.state.parties).every((p) => p.lockedBy === null && p.earnedDiscountCents === 0)).toBe(true)
    expect(r.state.ledger).toHaveLength(0)
    expect(r.exchange.payment.status).toBe('failed')
    // Released exchanges can no longer be finalized.
    const late = finalizeExchange(r.state, exchange.id, evidence(175), T0 + 3000, seqIds())
    expect(!late.ok && late.error.code).toBe('exchange_released')
  })

  it('records a full refund for a payment that lands after release', () => {
    const { state, exchange, ids } = quoteAndReserve(demoState())
    const released = unwrap(releaseExchange(state, exchange.id, 'expired', T0 + 2000)).state
    const refunded = unwrap(recordLatePaymentRefund(released, exchange.id, { refundId: 're_1', amountCents: 175 }, T0 + 3000, ids)).state
    expect(refunded.exchanges[exchange.id]!.status).toBe('refunded')
    expect(venueTotals(refunded).refundedCents).toBe(175)
    expect(refunded.queue).toEqual(['alice', 'bob', 'charlie', 'daniel'])
    expect(reconcileExchanges(refunded).every((x) => x.balanced)).toBe(true)
  })

  it('carries discounts through to the final discounted charge', () => {
    const { state, exchange, ids } = quoteAndReserve(demoState())
    let s = unwrap(finalizeExchange(state, exchange.id, evidence(175), T0 + 2000, ids)).state
    s = unwrap(callNext(s, T0 + 3000)).state // Daniel
    s = unwrap(completeService(s, 'daniel', T0 + 4000)).state
    s = unwrap(callNext(s, T0 + 5000)).state // Alice
    s = unwrap(completeService(s, 'alice', T0 + 6000)).state
    expect(s.parties.alice!.finalChargeCents).toBe(950)
    expect(s.parties.daniel!.finalChargeCents).toBe(800)
    expect(positionOf(s, 'bob')).toBe(1)
  })
})

describe('wait estimates', () => {
  it('sums service time of everyone ahead', () => {
    const w = estimateWaits(demoState(), T0)
    expect(w).toEqual({ alice: 0, bob: 180, charlie: 420, daniel: 540 })
  })
})
