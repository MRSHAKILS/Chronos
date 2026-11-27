import { createHash, randomBytes } from 'node:crypto'
import { menuItem } from '@/domain/demo'
import {
  attachPaymentSession,
  finalizeExchange,
  recordLatePaymentRefund,
  releaseExchange,
  reserveExchange,
} from '@/domain/exchange'
import { formatCents } from '@/domain/money'
import { callNext, clone, completeService, joinQueue, leaveQueue, ledgerEntry, updateConsent, type Ids } from '@/domain/queue'
import { issueQuote } from '@/domain/quote'
import { err, ok, type Result } from '@/domain/result'
import type { ConsentPolicy, Exchange, Quote, ReleaseReason, VenueState } from '@/domain/types'
import type { PaymentAdapter } from './payments/types'
import { mutate, readOrSeed, type Store } from './store'
import { seedState } from './seed'

export const MAX_QUEUE = 12
const CHECKOUT_CREATE_GRACE_MS = 2 * 60 * 1000

export interface Deps {
  store: Store
  payments: PaymentAdapter
  venueId: string
  now: () => number
  ids: Ids
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type Consent = Omit<ConsentPolicy, 'updatedAt'>

/** Adapts a domain transition result to the store's { state, value } shape. */
function as<S extends { state: VenueState }, T>(r: Result<S>, pick: (v: S) => T): Result<{ state: VenueState; value: T }> {
  return r.ok ? ok({ state: r.value.state, value: pick(r.value) }) : r
}

/**
 * The exchange lifecycle. Every state change is a pure domain transition run
 * through an atomic compare-and-set. Calls to the payment provider always
 * happen between transactions, never inside one: Stripe and the database do
 * not share a transaction, so each step is designed to be safely retried and
 * reconciled from the provider's authoritative state.
 */
export function createChronos(deps: Deps) {
  const { store, payments, venueId, now, ids } = deps
  const seed = () => seedState(now())
  const provider = payments.mode === 'stripe_sandbox' ? ('stripe' as const) : ('simulated' as const)
  const run = <T>(fn: (s: VenueState) => Result<{ state: VenueState; value: T }>) => mutate(store, venueId, seed, fn)
  const load = async () => (await readOrSeed(store, venueId, seed)).state

  async function join(
    input: { name: string; sku: string; consent: Consent; payWithCard: boolean },
    origin: string,
  ): Promise<Result<{ partyId: string; token: string; authorizationUrl: string | null }>> {
    const item = menuItem(input.sku)
    if (!item) return err('invalid_input', 'Unknown menu item')
    const token = randomBytes(32).toString('base64url')
    const partyId = ids.next('pty')
    const useStripe = input.payWithCard && Boolean(payments.createOrderAuthorization)
    const joined = await run((s) => {
      if (s.queue.length >= MAX_QUEUE) return err('invalid_state', 'The queue is full right now. Please try again shortly.')
      const r = joinQueue(
        s,
        {
          partyId,
          displayName: input.name,
          orderItems: [{ sku: item.sku, name: item.name, cents: item.cents }],
          serviceSec: item.serviceSec,
          consent: input.consent,
          payment: useStripe
            ? { kind: 'stripe', status: 'pending', authorizedCents: item.cents }
            : provider === 'simulated'
              ? { kind: 'simulated', status: 'authorized', authorizedCents: item.cents }
              : { kind: 'none' },
          tokenHash: hashToken(token),
        },
        now(),
      )
      return r.ok ? ok({ state: r.value.state, value: null }) : r
    })
    if (!joined.ok) return joined
    if (!useStripe) return ok({ partyId, token, authorizationUrl: null })

    try {
      const session = await payments.createOrderAuthorization!({
        venueId,
        partyId,
        amountCents: item.cents,
        title: `${item.name} at CHRONOS Coffee Lab (authorized now, captured after any discounts)`,
        successUrl: `${origin}/customer?authorized=1`,
        cancelUrl: `${origin}/customer?authorized=0`,
      })
      await run((s) => {
        const p = s.parties[partyId]
        if (!p || p.payment.kind !== 'stripe') return ok({ state: s, value: null })
        const next = clone(s)
        const pay = next.parties[partyId]!.payment
        if (pay.kind === 'stripe') pay.checkoutSessionId = session.sessionId
        return ok({ state: next, value: null })
      })
      return ok({ partyId, token, authorizationUrl: session.url })
    } catch (e) {
      await setOrderPayment(partyId, (p) => (p.kind === 'stripe' ? { ...p, status: 'failed', lastError: String(e) } : p))
      return ok({ partyId, token, authorizationUrl: null })
    }
  }

  async function setOrderPayment(partyId: string, fn: (p: VenueState['parties'][string]['payment']) => VenueState['parties'][string]['payment']) {
    return run((s) => {
      if (!s.parties[partyId]) return err('not_found', 'Customer not found')
      const next = clone(s)
      next.parties[partyId]!.payment = fn(next.parties[partyId]!.payment)
      return ok({ state: next, value: next.parties[partyId]! })
    })
  }

  /** Confirms an order authorization from Stripe's own record (never from the redirect). */
  async function reconcileOrderAuthorization(partyId: string) {
    const party = (await load()).parties[partyId]
    if (!party || party.payment.kind !== 'stripe' || party.payment.status !== 'pending' || !party.payment.checkoutSessionId) return
    if (!payments.getOrderAuthorizationFromSession) return
    const auth = await payments.getOrderAuthorizationFromSession(party.payment.checkoutSessionId)
    if (auth.state === 'pending') return
    await run((s) => {
      const p = s.parties[partyId]
      if (!p || p.payment.kind !== 'stripe' || p.payment.status !== 'pending') return ok({ state: s, value: null })
      const next = clone(s)
      const pay = next.parties[partyId]!.payment
      if (pay.kind !== 'stripe') return ok({ state: s, value: null })
      if (auth.state === 'authorized') {
        pay.status = 'authorized'
        pay.paymentIntentId = auth.paymentIntentId
        pay.captureBefore = auth.captureBefore
        pay.authorizedCents = auth.amountCapturableCents
        next.ledger.push(
          ledgerEntry(ids, now(), {
            kind: 'order_authorization',
            amountCents: auth.amountCapturableCents,
            provider: 'stripe',
            partyId,
            providerRef: auth.paymentIntentId,
            memo: `${p.displayName} authorized ${formatCents(auth.amountCapturableCents)} (manual capture)`,
          }),
        )
      } else {
        pay.status = auth.state === 'canceled' ? 'canceled' : 'failed'
      }
      return ok({ state: next, value: null })
    })
  }

  async function quote(partyId: string, target: number): Promise<Result<Quote>> {
    const r = await run((s) => as(issueQuote(s, partyId, target, now(), ids), (v) => v.quote))
    return r.ok ? ok(r.value.value) : r
  }

  /**
   * 1. Reserve positions atomically (validates quote id, expiry, version, consent).
   * 2. Create the payment session for the exact server-calculated amount.
   * 3. Attach the session to the reservation.
   */
  async function purchase(
    partyId: string,
    quoteId: string,
    origin: string,
  ): Promise<Result<{ exchangeId: string; sessionId: string; url: string | null; amountCents: number; mode: PaymentAdapter['mode'] }>> {
    const reserved = await run((s) => {
      const r = reserveExchange(s, { quoteId, requesterId: partyId, provider }, now(), ids)
      return r.ok ? ok({ state: r.value.state, value: r.value.exchange }) : r
    })
    if (!reserved.ok) return reserved
    const ex = reserved.value.value
    const q = ex.quote

    let session: { sessionId: string; url: string | null }
    try {
      session = await payments.createPriorityCheckout({
        venueId,
        exchangeId: ex.id,
        requesterId: partyId,
        amountCents: q.totalCents,
        title: `Priority: move from #${q.fromPosition} to #${q.targetPosition}`,
        description: `${q.affected.map((a) => `${a.displayName} ${formatCents(a.compensationCents)}`).join(', ')}, café fee ${formatCents(q.merchantFeeCents)}`,
        successUrl: `${origin}/customer?exchange=${ex.id}`,
        cancelUrl: `${origin}/customer?exchange=${ex.id}&cancelled=1`,
        reservationExpiresAt: ex.reservationExpiresAt,
      })
    } catch {
      await run((s) => as(releaseExchange(s, ex.id, 'checkout_error', now()), () => null))
      return err('invalid_state', 'Could not start checkout. Your place has not changed.')
    }

    const attached = await run((s) => as(attachPaymentSession(s, ex.id, session.sessionId, now()), () => null))
    if (!attached.ok) {
      // The reservation was released meanwhile (e.g. expired). Close the session so it cannot be paid.
      await payments.expirePriorityCheckout(session.sessionId).catch(() => undefined)
      return attached
    }
    return ok({ exchangeId: ex.id, sessionId: session.sessionId, url: session.url, amountCents: q.totalCents, mode: payments.mode })
  }

  /**
   * Brings an exchange in line with the payment provider's authoritative state.
   * Safe to call any number of times, from webhooks, return pages or a sweep.
   */
  async function reconcileExchange(exchangeId: string): Promise<Result<Exchange>> {
    const ex = (await load()).exchanges[exchangeId]
    if (!ex) return err('not_found', 'Exchange not found')
    if (ex.status === 'confirmed' || ex.status === 'refunded') return ok(ex)

    if (!ex.payment.sessionId) {
      if (ex.status === 'pending' && now() - ex.createdAt > CHECKOUT_CREATE_GRACE_MS) {
        return releaseAndReturn(exchangeId, 'checkout_error')
      }
      return ok(ex)
    }

    let status = await payments.getPriorityCheckout(ex.payment.sessionId)
    if (status.exchangeId && status.exchangeId !== ex.id) return err('amount_mismatch', 'Session does not belong to this exchange')

    if (status.state === 'open' && ex.status === 'pending' && now() > ex.reservationExpiresAt) {
      status = await payments.expirePriorityCheckout(ex.payment.sessionId)
    }

    if (status.state === 'paid') {
      const evidence = {
        provider,
        amountCents: status.amountCents,
        currency: status.currency,
        sessionId: status.sessionId,
        paymentIntentId: status.paymentIntentId,
      }
      const fin = await run((s) => {
        const r = finalizeExchange(s, exchangeId, evidence, now(), ids)
        return r.ok ? ok({ state: r.value.state, value: r.value.exchange }) : r
      })
      if (fin.ok) return ok(fin.value.value)
      if (fin.error.code !== 'exchange_released' && fin.error.code !== 'amount_mismatch') return fin
      // Payment landed after the reservation was released (or does not match): refund in full.
      if (fin.error.code === 'amount_mismatch') await run((s) => as(releaseExchange(s, exchangeId, 'payment_failed', now()), () => null))
      if (!status.paymentIntentId) return fin
      const refund = await payments.refundPriority(status.paymentIntentId, status.amountCents, `chronos-refund-${exchangeId}`)
      const rec = await run((s) => {
        const r = recordLatePaymentRefund(s, exchangeId, { ...refund, paymentIntentId: status.paymentIntentId, amountCents: status.amountCents }, now(), ids)
        return r.ok ? ok({ state: r.value.state, value: r.value.exchange }) : r
      })
      return rec.ok ? ok(rec.value.value) : rec
    }

    if (status.state === 'expired') return releaseAndReturn(exchangeId, 'expired')
    if (status.state === 'unpaid') return releaseAndReturn(exchangeId, 'payment_failed')
    return ok(ex)
  }

  async function releaseAndReturn(exchangeId: string, reason: ReleaseReason): Promise<Result<Exchange>> {
    const r = await run((s) => {
      const rel = releaseExchange(s, exchangeId, reason, now())
      return rel.ok ? ok({ state: rel.value.state, value: rel.value.exchange }) : rel
    })
    return r.ok ? ok(r.value.value) : r
  }

  /** Cancels a pending purchase. Positions are released only once the provider confirms no payment can happen. */
  async function cancelExchange(exchangeId: string, by: { partyId: string } | 'merchant'): Promise<Result<Exchange>> {
    const ex = (await load()).exchanges[exchangeId]
    if (!ex) return err('not_found', 'Exchange not found')
    if (by !== 'merchant' && ex.quote.requesterId !== by.partyId) return err('not_found', 'Exchange not found')
    if (ex.status !== 'pending') return ok(ex)
    if (ex.payment.sessionId) {
      const status = await payments.expirePriorityCheckout(ex.payment.sessionId)
      if (status.state === 'paid') return reconcileExchange(exchangeId)
    }
    return releaseAndReturn(exchangeId, by === 'merchant' ? 'merchant_cancelled' : 'cancelled')
  }

  async function resolveSimulated(sessionId: string, partyId: string, outcome: 'paid' | 'declined'): Promise<Result<Exchange>> {
    if (!('resolve' in payments)) return err('invalid_state', 'Simulated checkout is disabled while Stripe is configured')
    const sim = payments as unknown as { resolve: (id: string, p: string, o: 'paid' | 'declined') => Promise<Result<unknown>> }
    const r = await sim.resolve(sessionId, partyId, outcome)
    if (!r.ok) return r
    const exchangeId = (await load()).simulatedSessions[sessionId]?.exchangeId
    return exchangeId ? reconcileExchange(exchangeId) : err('not_found', 'Exchange not found')
  }

  /** Reconciles stale pending exchanges: expired reservations and checkouts that never started. */
  async function sweep(): Promise<void> {
    const state = await load()
    const stale = Object.values(state.exchanges).filter(
      (e) =>
        e.status === 'pending' &&
        (now() > e.reservationExpiresAt || (!e.payment.sessionId && now() - e.createdAt > CHECKOUT_CREATE_GRACE_MS)),
    )
    for (const e of stale) await reconcileExchange(e.id).catch(() => undefined)
  }

  /** Handles a verified Stripe event. Duplicate deliveries are ignored by event id. */
  async function handleStripeEvent(event: { id: string; type: string; data: { object: { metadata?: Record<string, string> | null } } }) {
    if ((await load()).processedEvents.includes(event.id)) return { duplicate: true }
    const meta = event.data.object.metadata ?? {}
    if (event.type.startsWith('checkout.session.')) {
      if (meta.chronos_kind === 'priority' && meta.exchange_id) await reconcileExchange(meta.exchange_id)
      if (meta.chronos_kind === 'order' && meta.party_id) await reconcileOrderAuthorization(meta.party_id)
    }
    await run((s) => {
      if (s.processedEvents.includes(event.id)) return ok({ state: s, value: null })
      const next = clone(s)
      next.processedEvents = [...next.processedEvents.slice(-499), event.id]
      return ok({ state: next, value: null })
    })
    return { duplicate: false }
  }

  /** Calls the next customer, or finishes the current one and captures the discounted amount. */
  async function serveNext(): Promise<Result<{ capturedPartyId?: string }>> {
    const r = await run((s) => {
      const servingId = s.queue.find((id) => s.parties[id]?.status === 'serving')
      if (!servingId) {
        const c = callNext(s, now())
        return c.ok ? ok({ state: c.value.state, value: { completed: null as string | null } }) : c
      }
      const c = completeService(s, servingId, now())
      if (!c.ok) return c
      const next = c.value.state
      const p = next.parties[servingId]!
      const final = p.finalChargeCents!
      if (p.payment.kind === 'simulated' && p.payment.status === 'authorized') {
        p.payment = { ...p.payment, status: 'captured', capturedCents: final }
        next.ledger.push(
          ledgerEntry(ids, now(), {
            kind: 'order_capture',
            amountCents: final,
            provider: 'simulated',
            partyId: p.id,
            memo: `${p.displayName}: ${formatCents(p.orderTotalCents)} authorized, ${formatCents(final)} captured`,
          }),
        )
      } else if (p.payment.kind === 'stripe' && p.payment.status === 'authorized') {
        p.payment = { ...p.payment, status: 'capture_pending' }
      }
      return ok({ state: next, value: { completed: servingId as string | null } })
    })
    if (!r.ok) return r
    const completed = r.value.value.completed
    if (completed) {
      const p = r.value.state.parties[completed]!
      if (p.payment.kind === 'stripe' && p.payment.status === 'capture_pending') await capture(completed)
    }
    return ok({ capturedPartyId: completed ?? undefined })
  }

  /** Captures the final discounted amount of a Stripe authorization, after validating eligibility. */
  async function capture(partyId: string): Promise<Result<null>> {
    const p = (await load()).parties[partyId]
    if (!p || p.payment.kind !== 'stripe' || !['capture_pending', 'capture_failed'].includes(p.payment.status)) {
      return err('invalid_state', 'Nothing to capture')
    }
    const pay = p.payment
    const final = p.finalChargeCents ?? 0
    const fail = async (message: string) => {
      await setOrderPayment(partyId, (x) => (x.kind === 'stripe' ? { ...x, status: 'capture_failed', lastError: message } : x))
      return err('invalid_state', message)
    }
    if (!pay.paymentIntentId || !payments.captureOrder || !payments.getOrderAuthorization) return fail('No authorization to capture')
    if (final > pay.authorizedCents) return fail('Final amount exceeds the authorization')
    if (pay.captureBefore && now() > pay.captureBefore) return fail('Authorization expired before capture')
    try {
      const auth = await payments.getOrderAuthorization(pay.paymentIntentId)
      if (auth.state !== 'authorized' || auth.amountCapturableCents < final) return fail(`Authorization is ${auth.state}`)
      const result = await payments.captureOrder(pay.paymentIntentId, final, `chronos-capture-${partyId}`)
      await run((s) => {
        const next = clone(s)
        const np = next.parties[partyId]!
        if (np.payment.kind !== 'stripe' || np.payment.status === 'captured') return ok({ state: s, value: null })
        np.payment = { ...np.payment, status: 'captured', capturedCents: result.capturedCents }
        next.ledger.push(
          ledgerEntry(ids, now(), {
            kind: 'order_capture',
            amountCents: result.capturedCents,
            provider: 'stripe',
            partyId,
            providerRef: pay.paymentIntentId,
            memo: `${np.displayName}: ${formatCents(pay.authorizedCents)} authorized, ${formatCents(result.capturedCents)} captured`,
          }),
        )
        return ok({ state: next, value: null })
      })
      return ok(null)
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Capture failed')
    }
  }

  return {
    provider,
    load,
    join,
    reconcileOrderAuthorization,
    updateConsent: (partyId: string, consent: Consent) =>
      run((s) => {
        const r = updateConsent(s, partyId, consent, now())
        return r.ok ? ok({ state: r.value.state, value: null }) : r
      }),
    leave: (partyId: string) => run((s) => {
      const r = leaveQueue(s, partyId, now(), ids)
      return r.ok ? ok({ state: r.value.state, value: null }) : r
    }),
    quote,
    purchase,
    reconcileExchange,
    cancelExchange,
    resolveSimulated,
    sweep,
    handleStripeEvent,
    serveNext,
    capture,
    reset: () => run(() => ok({ state: seedState(now()), value: null })),
  }
}

export type Chronos = ReturnType<typeof createChronos>
