import { sumCents } from './money'
import { activeParties, clone, positionOf, type Ids } from './queue'
import { err, ok, type DomainError, type Result } from './result'
import type { AffectedParty, Quote, VenueState } from './types'

/**
 * Prices moving `requesterId` to `targetPosition` (1-based).
 * Every party overtaken is paid exactly the compensation they set, and the
 * merchant earns a flat fee. Premium = Σ compensation + merchant fee, always.
 */
export function computeQuote(
  state: VenueState,
  requesterId: string,
  targetPosition: number,
  now: number,
  quoteId: string,
): Result<Quote> {
  const requester = state.parties[requesterId]
  const fromPosition = positionOf(state, requesterId)
  if (!requester || fromPosition === null) return err('not_found', 'You are not in this queue')
  if (requester.status !== 'waiting') return err('requester_not_waiting', 'Only waiting customers can buy priority')
  if (requester.lockedBy) return err('exchange_conflict', 'You are already part of a pending exchange')
  if (!Number.isSafeInteger(targetPosition) || targetPosition < 1 || targetPosition >= fromPosition) {
    return err('invalid_target', 'Target position must be ahead of your current position')
  }

  const queue = activeParties(state)
  const affectedParties = queue.slice(targetPosition - 1, fromPosition - 1)
  const affected: AffectedParty[] = []
  for (const [offset, party] of affectedParties.entries()) {
    const position = targetPosition + offset
    if (party.status === 'serving') {
      return err('party_serving', `${party.displayName} is already being served`, party.id)
    }
    if (party.lockedBy) {
      return err('exchange_conflict', `${party.displayName} is reserved by another pending exchange`, party.id)
    }
    if (!party.consent.optIn) {
      return err('not_consented', `${party.displayName} has not opted in to priority exchanges`, party.id)
    }
    const additionalDelaySec = requester.serviceSec
    const cumulativeDelayAfterSec = party.addedDelaySec + additionalDelaySec
    if (cumulativeDelayAfterSec > party.consent.maxAdditionalDelaySec) {
      return err(
        'delay_exceeded',
        `${party.displayName} accepts at most ${party.consent.maxAdditionalDelaySec}s of added wait`,
        party.id,
      )
    }
    const compensationCents = party.consent.minCompensationCents
    const orderTotalAfterCents = party.orderTotalCents - party.earnedDiscountCents - compensationCents
    if (orderTotalAfterCents < party.minChargeCents) {
      return err('below_min_charge', `Compensation would discount ${party.displayName}'s order below its minimum charge`, party.id)
    }
    affected.push({
      partyId: party.id,
      displayName: party.displayName,
      position,
      compensationCents,
      additionalDelaySec,
      cumulativeDelayAfterSec,
      consent: { ...party.consent },
      orderTotalAfterCents,
    })
  }

  const compensationTotalCents = sumCents(affected.map((a) => a.compensationCents))
  const merchantFeeCents = state.config.merchantFeeCents
  const totalCents = sumCents([compensationTotalCents, merchantFeeCents])
  if (totalCents < state.config.paymentMinimumCents) {
    return err('below_payment_minimum', `Priority purchases must be at least ${state.config.paymentMinimumCents}¢`)
  }

  return ok({
    id: quoteId,
    venueId: state.config.id,
    requesterId,
    queueVersion: state.queueVersion,
    fromPosition,
    targetPosition,
    affected,
    compensationTotalCents,
    merchantFeeCents,
    totalCents,
    timeSavedSec: affectedParties.reduce((s, p) => s + p.serviceSec, 0),
    currency: state.config.currency,
    issuedAt: now,
    expiresAt: now + state.config.quoteTtlSec * 1000,
  })
}

export type LadderStep =
  | { targetPosition: number; available: true; quote: Omit<Quote, 'id'> }
  | { targetPosition: number; available: false; reason: DomainError }

/** Every reachable target position for a requester, priced or with the reason it is unavailable. */
export function quoteLadder(state: VenueState, requesterId: string, now: number): LadderStep[] {
  const from = positionOf(state, requesterId)
  if (from === null) return []
  const steps: LadderStep[] = []
  for (let target = from - 1; target >= 1; target--) {
    const result = computeQuote(state, requesterId, target, now, 'preview')
    if (result.ok) {
      const { id: _id, ...quote } = result.value
      void _id
      steps.push({ targetPosition: target, available: true, quote })
    } else {
      steps.push({ targetPosition: target, available: false, reason: result.error })
    }
  }
  return steps
}

/** Issues and stores a quote so it can later be accepted by id only. */
export function issueQuote(
  state: VenueState,
  requesterId: string,
  targetPosition: number,
  now: number,
  ids: Ids,
): Result<{ state: VenueState; quote: Quote }> {
  const result = computeQuote(state, requesterId, targetPosition, now, ids.next('quo'))
  if (!result.ok) return result
  const next = clone(state)
  // Drop expired quotes so the document stays small.
  for (const [id, q] of Object.entries(next.quotes)) {
    if (q.expiresAt < now) delete next.quotes[id]
  }
  next.quotes[result.value.id] = result.value
  return ok({ state: next, quote: result.value })
}

/** True when two quotes price the same exchange identically (ids and timestamps ignored). */
export function quotesEquivalent(a: Quote, b: Quote): boolean {
  if (
    a.requesterId !== b.requesterId ||
    a.queueVersion !== b.queueVersion ||
    a.fromPosition !== b.fromPosition ||
    a.targetPosition !== b.targetPosition ||
    a.totalCents !== b.totalCents ||
    a.merchantFeeCents !== b.merchantFeeCents ||
    a.compensationTotalCents !== b.compensationTotalCents ||
    a.affected.length !== b.affected.length
  ) {
    return false
  }
  return a.affected.every((x, i) => {
    const y = b.affected[i]!
    return x.partyId === y.partyId && x.compensationCents === y.compensationCents && x.additionalDelaySec === y.additionalDelaySec
  })
}
