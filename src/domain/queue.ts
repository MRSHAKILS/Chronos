import { assertCents, ceilBps, sumCents, type Cents } from './money'
import { err, ok, type Result } from './result'
import type { ConsentPolicy, LedgerEntry, OrderItem, OrderPayment, Party, VenueConfig, VenueState } from './types'

export interface Ids {
  next(prefix: string): string
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createVenueState(config: VenueConfig, now: number): VenueState {
  return {
    config,
    queueVersion: 1,
    queue: [],
    parties: {},
    quotes: {},
    exchanges: {},
    ledger: [],
    processedEvents: [],
    simulatedSessions: {},
    seededAt: now,
  }
}

/** 1-based queue position, or null when the party is not in the active queue. */
export function positionOf(state: VenueState, partyId: string): number | null {
  const index = state.queue.indexOf(partyId)
  return index === -1 ? null : index + 1
}

export function getParty(state: VenueState, partyId: string): Party | undefined {
  return state.parties[partyId]
}

export function activeParties(state: VenueState): Party[] {
  return state.queue.map((id) => {
    const p = state.parties[id]
    if (!p) throw new Error(`queue references unknown party ${id}`)
    return p
  })
}

export function minChargeFor(config: VenueConfig, orderTotalCents: Cents): Cents {
  return Math.min(orderTotalCents, Math.max(config.minChargeFloorCents, ceilBps(orderTotalCents, config.minChargeRatioBps)))
}

/**
 * Estimated seconds until each active party reaches the counter.
 * A party being served contributes its remaining service time.
 */
export function estimateWaits(state: VenueState, now: number): Record<string, number> {
  const waits: Record<string, number> = {}
  let elapsed = 0
  for (const party of activeParties(state)) {
    waits[party.id] = elapsed
    if (party.status === 'serving') {
      const started = party.servingStartedAt ?? now
      elapsed += Math.max(0, party.serviceSec - Math.floor((now - started) / 1000))
    } else {
      elapsed += party.serviceSec
    }
  }
  return waits
}

export interface JoinInput {
  partyId: string
  displayName: string
  orderItems: OrderItem[]
  serviceSec: number
  consent: Omit<ConsentPolicy, 'updatedAt'>
  payment: OrderPayment
  tokenHash: string | null
  seeded?: boolean
}

export function joinQueue(state: VenueState, input: JoinInput, now: number): Result<{ state: VenueState; party: Party }> {
  if (state.parties[input.partyId]) return err('invalid_input', 'Party id already exists')
  if (input.orderItems.length === 0) return err('invalid_input', 'An order needs at least one item')
  const consentCheck = validateConsent(input.consent)
  if (!consentCheck.ok) return consentCheck
  const orderTotalCents = sumCents(input.orderItems.map((i) => i.cents))
  const party: Party = {
    id: input.partyId,
    displayName: input.displayName,
    orderItems: input.orderItems,
    orderTotalCents,
    minChargeCents: minChargeFor(state.config, orderTotalCents),
    serviceSec: input.serviceSec,
    joinedAt: now,
    status: 'waiting',
    consent: { ...input.consent, updatedAt: now },
    addedDelaySec: 0,
    earnedDiscountCents: 0,
    lockedBy: null,
    payment: input.payment,
    seeded: input.seeded ?? false,
    tokenHash: input.tokenHash,
  }
  const next = clone(state)
  next.parties[party.id] = party
  next.queue.push(party.id)
  next.queueVersion += 1
  return ok({ state: next, party })
}

function validateConsent(consent: Omit<ConsentPolicy, 'updatedAt'>): Result<true> {
  if (!Number.isSafeInteger(consent.minCompensationCents) || consent.minCompensationCents < 0) {
    return err('invalid_input', 'Minimum compensation must be a non-negative integer number of cents')
  }
  if (!Number.isSafeInteger(consent.maxAdditionalDelaySec) || consent.maxAdditionalDelaySec < 0) {
    return err('invalid_input', 'Maximum additional delay must be a non-negative whole number of seconds')
  }
  return ok(true)
}

/**
 * Consent may not change while the party is reserved by a pending exchange:
 * the overtaking customer is paying against the snapshot they were quoted.
 */
export function updateConsent(
  state: VenueState,
  partyId: string,
  consent: Omit<ConsentPolicy, 'updatedAt'>,
  now: number,
): Result<{ state: VenueState }> {
  const party = state.parties[partyId]
  if (!party) return err('not_found', 'Party not found')
  if (party.status !== 'waiting') return err('invalid_state', 'Consent can only be changed while waiting', partyId)
  if (party.lockedBy) return err('locked_in_exchange', 'Consent is locked while an exchange involving you is pending', partyId)
  const check = validateConsent(consent)
  if (!check.ok) return check
  const next = clone(state)
  next.parties[partyId]!.consent = { ...consent, updatedAt: now }
  next.queueVersion += 1
  return ok({ state: next })
}

export function leaveQueue(state: VenueState, partyId: string, now: number, ids: Ids): Result<{ state: VenueState }> {
  const party = state.parties[partyId]
  if (!party) return err('not_found', 'Party not found')
  if (party.status !== 'waiting') return err('invalid_state', 'Only waiting parties can leave', partyId)
  if (party.lockedBy) return err('locked_in_exchange', 'Cannot leave while an exchange involving you is pending', partyId)
  const next = clone(state)
  const p = next.parties[partyId]!
  p.status = 'left'
  next.queue = next.queue.filter((id) => id !== partyId)
  next.queueVersion += 1
  if (p.earnedDiscountCents > 0) {
    // The overtaking customer already paid; the unused discount stays with the merchant and is recorded, not hidden.
    next.ledger.push(ledgerEntry(ids, now, {
      kind: 'compensation_forfeited',
      amountCents: 0,
      provider: 'none',
      partyId,
      memo: `${p.displayName} left with ${p.earnedDiscountCents}¢ of unused compensation`,
    }))
  }
  return ok({ state: next })
}

/** Moves the head of the queue to the counter. A reserved head cannot be called. */
export function callNext(state: VenueState, now: number): Result<{ state: VenueState; party: Party }> {
  const headId = state.queue[0]
  if (!headId) return err('queue_empty', 'Nobody is waiting')
  const head = state.parties[headId]!
  if (head.status === 'serving') return err('invalid_state', `${head.displayName} is already at the counter`, headId)
  if (head.lockedBy) {
    return err('locked_in_exchange', `${head.displayName} is reserved by a pending exchange; confirm or cancel it first`, headId)
  }
  const next = clone(state)
  const p = next.parties[headId]!
  p.status = 'serving'
  p.servingStartedAt = now
  next.queueVersion += 1
  return ok({ state: next, party: p })
}

/** Final amount to charge for an order: total minus earned discounts, never below the minimum charge. */
export function finalChargeFor(party: Party): Cents {
  const final = party.orderTotalCents - party.earnedDiscountCents
  if (final < party.minChargeCents) {
    throw new Error(`invariant violated: ${party.id} discounted below minimum charge`)
  }
  return assertCents(final)
}

export function completeService(state: VenueState, partyId: string, now: number): Result<{ state: VenueState; party: Party }> {
  const party = state.parties[partyId]
  if (!party) return err('not_found', 'Party not found')
  if (party.status !== 'serving') return err('invalid_state', 'Only the party at the counter can be completed', partyId)
  const next = clone(state)
  const p = next.parties[partyId]!
  p.status = 'served'
  p.servedAt = now
  p.finalChargeCents = finalChargeFor(p)
  next.queue = next.queue.filter((id) => id !== partyId)
  next.queueVersion += 1
  return ok({ state: next, party: p })
}

export function ledgerEntry(ids: Ids, now: number, entry: Omit<LedgerEntry, 'id' | 'at'>): LedgerEntry {
  return { id: ids.next('led'), at: now, ...entry }
}
