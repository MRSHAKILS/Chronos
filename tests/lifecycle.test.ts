import { describe, expect, it } from 'vitest'
import { DEMO_VENUE_ID } from '@/domain/demo'
import { reconcileExchanges, venueTotals } from '@/domain/reconcile'
import { createChronos } from '@/server/lifecycle'
import { SimulatedAdapter } from '@/server/payments/simulated'
import type { CheckoutStatus, PaymentAdapter, PriorityCheckoutInput } from '@/server/payments/types'
import { seedState } from '@/server/seed'
import { MemoryStore } from '@/server/store'
import { T0, seqIds } from './helpers'

const ORIGIN = 'http://localhost:3000'
const danielJoin = {
  name: 'Daniel',
  sku: 'cold-brew',
  consent: { optIn: false, minCompensationCents: 50, maxAdditionalDelaySec: 0 },
  payWithCard: false,
}

/** Fake provider with Stripe-like semantics, controllable from the test. */
class FakeProvider implements PaymentAdapter {
  readonly mode = 'stripe_sandbox' as const
  sessions = new Map<string, CheckoutStatus>()
  refunds: string[] = []
  failCreate = false
  async createPriorityCheckout(input: PriorityCheckoutInput) {
    if (this.failCreate) throw new Error('network down')
    const sessionId = `cs_${input.exchangeId}`
    this.sessions.set(sessionId, { sessionId, state: 'open', amountCents: input.amountCents, currency: 'usd', exchangeId: input.exchangeId })
    return { sessionId, url: `https://checkout.test/${sessionId}` }
  }
  async getPriorityCheckout(id: string) {
    return this.sessions.get(id)!
  }
  async expirePriorityCheckout(id: string) {
    const s = this.sessions.get(id)!
    if (s.state === 'open') s.state = 'expired'
    return s
  }
  async refundPriority(pi: string) {
    this.refunds.push(pi)
    return { refundId: `re_${pi}` }
  }
  pay(id: string) {
    const s = this.sessions.get(id)!
    s.state = 'paid'
    s.paymentIntentId = `pi_${id}`
  }
}

function setup(kind: 'sim' | 'fake' = 'sim') {
  let clock = T0
  const now = () => clock
  const store = new MemoryStore()
  const fake = new FakeProvider()
  let n = 0
  const payments =
    kind === 'fake' ? fake : new SimulatedAdapter(store, DEMO_VENUE_ID, () => seedState(now()), now, () => `s${++n}`.padEnd(12, '0'))
  const chronos = createChronos({ store, payments, venueId: DEMO_VENUE_ID, now, ids: seqIds() })
  return { chronos, store, fake, payments, tick: (ms: number) => (clock += ms) }
}

async function danielBuysFirstPlace(chronos: ReturnType<typeof setup>['chronos']) {
  const joined = await chronos.join(danielJoin, ORIGIN)
  if (!joined.ok) throw new Error(joined.error.message)
  const partyId = joined.value.partyId
  const quote = await chronos.quote(partyId, 1)
  if (!quote.ok) throw new Error(quote.error.message)
  const purchase = await chronos.purchase(partyId, quote.value.id, ORIGIN)
  if (!purchase.ok) throw new Error(purchase.error.message)
  return { partyId, quote: quote.value, purchase: purchase.value }
}

describe('exchange lifecycle (simulated provider)', () => {
  it('runs the canonical demo end to end and balances the ledger', async () => {
    const { chronos, payments } = setup()
    const { partyId, purchase } = await danielBuysFirstPlace(chronos)
    // Positions are reserved but the queue has not moved before payment.
    let state = await chronos.load()
    expect(state.queue.indexOf(partyId)).toBe(3)
    expect(state.parties.alice!.lockedBy).toBe(purchase.exchangeId)

    const r = await chronos.resolveSimulated(purchase.sessionId, partyId, 'paid')
    expect(r.ok && r.value.status).toBe('confirmed')
    state = await chronos.load()
    expect(state.queue).toEqual([partyId, 'alice', 'bob', 'charlie'])
    expect(venueTotals(state)).toMatchObject({ premiumCollectedCents: 175, compensationIssuedCents: 150, merchantFeeRevenueCents: 25 })
    expect(reconcileExchanges(state).every((x) => x.balanced)).toBe(true)
    expect(payments.mode).toBe('simulation')
  })

  it('declined payment releases the reservation and leaves the queue unchanged', async () => {
    const { chronos } = setup()
    const before = (await chronos.load()).queue
    const { partyId, purchase } = await danielBuysFirstPlace(chronos)
    const r = await chronos.resolveSimulated(purchase.sessionId, partyId, 'declined')
    expect(r.ok && r.value.status).toBe('released')
    const state = await chronos.load()
    expect(state.queue).toEqual([...before, partyId])
    expect(Object.values(state.parties).every((p) => p.lockedBy === null && p.earnedDiscountCents === 0)).toBe(true)
    expect(state.ledger).toHaveLength(0)
  })

  it('a session cannot be resolved by someone other than the buyer', async () => {
    const { chronos } = setup()
    const { purchase } = await danielBuysFirstPlace(chronos)
    const r = await chronos.resolveSimulated(purchase.sessionId, 'alice', 'paid')
    expect(r.ok).toBe(false)
  })

  it('rejects a second purchase that overlaps a pending reservation', async () => {
    const { chronos } = setup()
    await danielBuysFirstPlace(chronos)
    const erin = await chronos.join({ ...danielJoin, name: 'Erin' }, ORIGIN)
    if (!erin.ok) throw new Error()
    const q = await chronos.quote(erin.value.partyId, 1)
    expect(!q.ok && q.error.code).toBe('exchange_conflict')
  })
})

describe('exchange lifecycle (Stripe-like provider)', () => {
  it('applies a paid exchange exactly once across duplicate webhook deliveries and return-page reconciles', async () => {
    const { chronos, fake } = setup('fake')
    const { partyId, purchase } = await danielBuysFirstPlace(chronos)
    fake.pay(purchase.sessionId)
    const event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { metadata: { chronos_kind: 'priority', exchange_id: purchase.exchangeId } } },
    }
    expect((await chronos.handleStripeEvent(event)).duplicate).toBe(false)
    expect((await chronos.handleStripeEvent(event)).duplicate).toBe(true)
    await chronos.reconcileExchange(purchase.exchangeId) // success redirect
    await chronos.reconcileExchange(purchase.exchangeId)
    const state = await chronos.load()
    expect(state.queue[0]).toBe(partyId)
    expect(state.parties.alice!.earnedDiscountCents).toBe(50)
    expect(state.ledger.filter((l) => l.kind === 'priority_premium')).toHaveLength(1)
  })

  it('concurrent purchases of overlapping quotes: exactly one reserves', async () => {
    const { chronos } = setup('fake')
    const a = await chronos.join(danielJoin, ORIGIN)
    if (!a.ok) throw new Error()
    const q1 = await chronos.quote(a.value.partyId, 1)
    const q2 = await chronos.quote(a.value.partyId, 2)
    if (!q1.ok || !q2.ok) throw new Error()
    const results = await Promise.all([
      chronos.purchase(a.value.partyId, q1.value.id, ORIGIN),
      chronos.purchase(a.value.partyId, q2.value.id, ORIGIN),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const state = await chronos.load()
    expect(Object.values(state.exchanges).filter((e) => e.status === 'pending')).toHaveLength(1)
  })

  it('releases the reservation when checkout cannot be created', async () => {
    const { chronos, fake } = setup('fake')
    fake.failCreate = true
    const joined = await chronos.join(danielJoin, ORIGIN)
    if (!joined.ok) throw new Error()
    const quote = await chronos.quote(joined.value.partyId, 1)
    if (!quote.ok) throw new Error()
    const r = await chronos.purchase(joined.value.partyId, quote.value.id, ORIGIN)
    expect(r.ok).toBe(false)
    const state = await chronos.load()
    expect(Object.values(state.parties).every((p) => p.lockedBy === null)).toBe(true)
    expect(Object.values(state.exchanges)[0]!.releaseReason).toBe('checkout_error')
  })

  it('expires an abandoned checkout after the reservation window and frees the queue', async () => {
    const { chronos, fake, tick } = setup('fake')
    const { purchase } = await danielBuysFirstPlace(chronos)
    tick(16 * 60 * 1000)
    await chronos.sweep()
    expect(fake.sessions.get(purchase.sessionId)!.state).toBe('expired')
    const state = await chronos.load()
    expect(state.exchanges[purchase.exchangeId]!.status).toBe('released')
    expect(state.parties.alice!.lockedBy).toBeNull()
  })

  it('refunds a payment that lands after its reservation was released, leaving the queue unchanged', async () => {
    const { chronos, fake } = setup('fake')
    const { partyId, purchase } = await danielBuysFirstPlace(chronos)
    // Merchant cancels while the provider still shows the session open (we force-release locally)…
    await chronos.cancelExchange(purchase.exchangeId, 'merchant')
    // …but the customer's payment had already gone through at the provider.
    const s = fake.sessions.get(purchase.sessionId)!
    s.state = 'paid'
    s.paymentIntentId = 'pi_late'
    const r = await chronos.reconcileExchange(purchase.exchangeId)
    expect(r.ok && r.value.status).toBe('refunded')
    expect(fake.refunds).toEqual(['pi_late'])
    const state = await chronos.load()
    expect(state.queue.at(-1)).toBe(partyId)
    expect(reconcileExchanges(state).every((x) => x.balanced)).toBe(true)
  })

  it('cancelling honours a payment that already succeeded instead of discarding it', async () => {
    const { chronos, fake } = setup('fake')
    const { partyId, purchase } = await danielBuysFirstPlace(chronos)
    fake.pay(purchase.sessionId)
    const r = await chronos.cancelExchange(purchase.exchangeId, { partyId })
    expect(r.ok && r.value.status).toBe('confirmed')
  })
})

describe('service and capture', () => {
  it('captures the final discounted amount when serving', async () => {
    const { chronos } = setup()
    const { partyId, purchase } = await danielBuysFirstPlace(chronos)
    await chronos.resolveSimulated(purchase.sessionId, partyId, 'paid')
    await chronos.serveNext() // call Daniel
    await chronos.serveNext() // finish Daniel
    await chronos.serveNext() // call Alice
    await chronos.serveNext() // finish Alice
    const state = await chronos.load()
    const alice = state.parties.alice!
    expect(alice.finalChargeCents).toBe(950)
    expect(alice.payment).toMatchObject({ kind: 'simulated', status: 'captured', capturedCents: 950 })
    expect(venueTotals(state).capturedCents).toBe(800 + 950)
  })
})

describe('public demo stays usable', () => {
  it('a second visitor can still buy priority after the first exchange', async () => {
    const { chronos } = setup()
    const first = await danielBuysFirstPlace(chronos)
    await chronos.resolveSimulated(first.purchase.sessionId, first.partyId, 'paid')
    const erin = await chronos.join({ ...danielJoin, name: 'Erin', sku: 'espresso' }, ORIGIN)
    if (!erin.ok) throw new Error(erin.error.message)
    // Erin is #5 behind Charlie; passing Charlie, Bob and Alice is still within their delay limits.
    const q = await chronos.quote(erin.value.partyId, 2)
    expect(q.ok && q.value.affected.map((a) => a.displayName)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('re-seeds itself after 10 minutes without activity', async () => {
    const { chronos, tick } = setup()
    await chronos.join(danielJoin, ORIGIN)
    expect((await chronos.load()).queue).toHaveLength(4)
    tick(9 * 60 * 1000)
    expect((await chronos.load()).queue).toHaveLength(4)
    tick(2 * 60 * 1000)
    expect((await chronos.load()).queue).toEqual(['alice', 'bob', 'charlie'])
  })

  it('does not re-seed while a payment is pending', async () => {
    const { chronos, tick } = setup()
    await danielBuysFirstPlace(chronos)
    tick(11 * 60 * 1000)
    expect((await chronos.load()).queue).toHaveLength(4)
  })
})
