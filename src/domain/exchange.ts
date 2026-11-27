import { clone, ledgerEntry, positionOf, type Ids } from './queue'
import { computeQuote, quotesEquivalent } from './quote'
import { err, ok, type Result } from './result'
import type { Exchange, ExchangePayment, ReleaseReason, VenueState } from './types'

/**
 * Exchange lifecycle:
 *
 *   reserve ──► pending ──► confirmed           (payment verified server-side)
 *                  │
 *                  └──────► released ──► refunded (payment landed after release)
 *
 * Every transition is a pure function of the venue state so the store can run
 * it as one atomic check-and-write.
 */

export function reserveExchange(
  state: VenueState,
  input: { quoteId: string; requesterId: string; provider: ExchangePayment['provider'] },
  now: number,
  ids: Ids,
): Result<{ state: VenueState; exchange: Exchange }> {
  const quote = state.quotes[input.quoteId]
  if (!quote || quote.requesterId !== input.requesterId) return err('quote_not_found', 'Quote not found')
  if (now > quote.expiresAt) return err('quote_expired', 'This quote has expired; request a new one')
  if (quote.queueVersion !== state.queueVersion) {
    return err('stale_version', 'The queue changed since this quote was issued; request a new one')
  }
  // Re-price against the live queue. Any difference is a rejection, never a silent re-price.
  const fresh = computeQuote(state, quote.requesterId, quote.targetPosition, now, quote.id)
  if (!fresh.ok) return fresh
  if (!quotesEquivalent(quote, fresh.value)) return err('quote_mismatch', 'The price changed; request a new quote')

  const next = clone(state)
  const exchange: Exchange = {
    id: ids.next('exc'),
    venueId: state.config.id,
    quote,
    status: 'pending',
    createdAt: now,
    reservationExpiresAt: now + state.config.reservationTtlSec * 1000,
    payment: { provider: input.provider, status: 'creating', amountCents: quote.totalCents },
    events: [{ at: now, type: 'reserved', detail: `Reserved ${quote.affected.length} position(s) for ${quote.totalCents}¢` }],
  }
  for (const id of [quote.requesterId, ...quote.affected.map((a) => a.partyId)]) {
    next.parties[id]!.lockedBy = exchange.id
  }
  delete next.quotes[quote.id]
  next.exchanges[exchange.id] = exchange
  next.queueVersion += 1
  return ok({ state: next, exchange })
}

export function attachPaymentSession(
  state: VenueState,
  exchangeId: string,
  sessionId: string,
  now: number,
): Result<{ state: VenueState; exchange: Exchange }> {
  const ex = state.exchanges[exchangeId]
  if (!ex) return err('not_found', 'Exchange not found')
  if (ex.status !== 'pending') return err('exchange_not_pending', `Exchange is ${ex.status}`)
  const next = clone(state)
  const e = next.exchanges[exchangeId]!
  e.payment.sessionId = sessionId
  e.payment.status = 'open'
  e.events.push({ at: now, type: 'checkout_opened', detail: sessionId })
  return ok({ state: next, exchange: e })
}

export interface PaymentEvidence {
  provider: ExchangePayment['provider']
  amountCents: number
  currency: string
  sessionId: string
  paymentIntentId?: string
}

/**
 * Applies a paid exchange exactly once. Calling it again on a confirmed
 * exchange is a no-op that reports applied=false.
 */
export function finalizeExchange(
  state: VenueState,
  exchangeId: string,
  evidence: PaymentEvidence,
  now: number,
  ids: Ids,
): Result<{ state: VenueState; exchange: Exchange; applied: boolean }> {
  const ex = state.exchanges[exchangeId]
  if (!ex) return err('not_found', 'Exchange not found')
  if (ex.status === 'confirmed') return ok({ state, exchange: ex, applied: false })
  if (ex.status !== 'pending') return err('exchange_released', `Exchange was ${ex.status} before payment arrived`)
  if (evidence.provider !== ex.payment.provider) return err('amount_mismatch', 'Payment provider does not match the exchange')
  if (evidence.amountCents !== ex.quote.totalCents || evidence.currency.toLowerCase() !== ex.quote.currency) {
    return err('amount_mismatch', `Paid ${evidence.amountCents} ${evidence.currency}, expected ${ex.quote.totalCents} ${ex.quote.currency}`)
  }
  if (ex.payment.sessionId && ex.payment.sessionId !== evidence.sessionId) {
    return err('amount_mismatch', 'Payment session does not belong to this exchange')
  }

  const { quote } = ex
  const lockedIds = [quote.requesterId, ...quote.affected.map((a) => a.partyId)]
  for (const id of lockedIds) {
    const p = state.parties[id]
    if (!p || p.lockedBy !== ex.id || positionOf(state, id) === null) {
      return err('invalid_state', `Reservation for ${id} is no longer intact`, id)
    }
  }
  // Locked parties cannot move, leave or be served, so the overtaken block is still
  // contiguous and directly ahead of the requester. Verify rather than assume.
  const reqPos = positionOf(state, quote.requesterId)!
  const firstPos = positionOf(state, quote.affected[0]!.partyId)!
  if (reqPos - firstPos !== quote.affected.length) {
    return err('invalid_state', 'Reserved block is no longer contiguous')
  }

  const next = clone(state)
  next.queue.splice(reqPos - 1, 1)
  next.queue.splice(firstPos - 1, 0, quote.requesterId)
  for (const a of quote.affected) {
    const p = next.parties[a.partyId]!
    p.earnedDiscountCents += a.compensationCents
    p.addedDelaySec += a.additionalDelaySec
    if (p.orderTotalCents - p.earnedDiscountCents < p.minChargeCents) {
      throw new Error(`invariant violated: ${p.id} below minimum charge`)
    }
  }
  for (const id of lockedIds) next.parties[id]!.lockedBy = null
  next.queueVersion += 1

  const e = next.exchanges[exchangeId]!
  e.status = 'confirmed'
  e.confirmedAt = now
  e.appliedQueueVersion = next.queueVersion
  e.payment.status = 'paid'
  e.payment.sessionId = evidence.sessionId
  if (evidence.paymentIntentId) e.payment.paymentIntentId = evidence.paymentIntentId
  e.events.push({ at: now, type: 'confirmed', detail: `Moved from #${quote.fromPosition} to #${quote.targetPosition}` })

  const requesterName = next.parties[quote.requesterId]!.displayName
  const ref = evidence.paymentIntentId ?? evidence.sessionId
  next.ledger.push(
    ledgerEntry(ids, now, {
      kind: 'priority_premium',
      amountCents: quote.totalCents,
      provider: evidence.provider,
      exchangeId,
      partyId: quote.requesterId,
      providerRef: ref,
      memo: `${requesterName} bought #${quote.fromPosition} → #${quote.targetPosition}`,
    }),
  )
  for (const a of quote.affected) {
    next.ledger.push(
      ledgerEntry(ids, now, {
        kind: 'customer_compensation',
        amountCents: a.compensationCents,
        provider: evidence.provider,
        exchangeId,
        partyId: a.partyId,
        memo: `${a.displayName} discount for +${a.additionalDelaySec}s`,
      }),
    )
  }
  next.ledger.push(
    ledgerEntry(ids, now, {
      kind: 'merchant_fee',
      amountCents: quote.merchantFeeCents,
      provider: evidence.provider,
      exchangeId,
      memo: 'Merchant exchange fee',
    }),
  )
  return ok({ state: next, exchange: e, applied: true })
}

/** Releases a pending reservation. Idempotent: non-pending exchanges are returned unchanged. */
export function releaseExchange(
  state: VenueState,
  exchangeId: string,
  reason: ReleaseReason,
  now: number,
): Result<{ state: VenueState; exchange: Exchange; released: boolean }> {
  const ex = state.exchanges[exchangeId]
  if (!ex) return err('not_found', 'Exchange not found')
  if (ex.status !== 'pending') return ok({ state, exchange: ex, released: false })
  const next = clone(state)
  const e = next.exchanges[exchangeId]!
  for (const id of [e.quote.requesterId, ...e.quote.affected.map((a) => a.partyId)]) {
    const p = next.parties[id]
    if (p && p.lockedBy === e.id) p.lockedBy = null
  }
  e.status = 'released'
  e.releasedAt = now
  e.releaseReason = reason
  e.payment.status = reason === 'payment_failed' || reason === 'checkout_error' ? 'failed' : 'expired'
  e.events.push({ at: now, type: 'released', detail: reason })
  next.queueVersion += 1
  return ok({ state: next, exchange: e, released: true })
}

/** Records a refund for a payment that arrived after its reservation was released. */
export function recordLatePaymentRefund(
  state: VenueState,
  exchangeId: string,
  refund: { refundId: string; paymentIntentId?: string; amountCents: number },
  now: number,
  ids: Ids,
): Result<{ state: VenueState; exchange: Exchange }> {
  const ex = state.exchanges[exchangeId]
  if (!ex) return err('not_found', 'Exchange not found')
  if (ex.status === 'refunded') return ok({ state, exchange: ex })
  if (ex.status !== 'released') return err('invalid_state', `Cannot refund a ${ex.status} exchange`)
  const next = clone(state)
  const e = next.exchanges[exchangeId]!
  e.status = 'refunded'
  e.payment.status = 'refunded'
  e.payment.refundId = refund.refundId
  if (refund.paymentIntentId) e.payment.paymentIntentId = refund.paymentIntentId
  e.events.push({ at: now, type: 'refunded', detail: 'Payment arrived after the reservation was released' })
  next.ledger.push(
    ledgerEntry(ids, now, {
      kind: 'priority_refund',
      amountCents: refund.amountCents,
      provider: e.payment.provider,
      exchangeId,
      partyId: e.quote.requesterId,
      providerRef: refund.refundId,
      memo: 'Late payment refunded in full; queue unchanged',
    }),
  )
  return ok({ state: next, exchange: e })
}

export function appendExchangeEvent(state: VenueState, exchangeId: string, type: string, detail: string, now: number): VenueState {
  const next = clone(state)
  next.exchanges[exchangeId]?.events.push({ at: now, type, detail })
  return next
}
