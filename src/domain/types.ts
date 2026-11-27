import type { Cents } from './money'

/**
 * Domain vocabulary is industry-neutral: a Venue runs a queue of Parties.
 * A café is one configuration; a clinic, a DMV counter or a ride pickup
 * line use the same engine with different seed data.
 */

export interface VenueConfig {
  id: string
  name: string
  currency: 'usd'
  /** Flat merchant fee earned on each confirmed priority exchange. */
  merchantFeeCents: Cents
  /** How long a priority quote remains valid. */
  quoteTtlSec: number
  /** How long positions stay reserved while payment is pending. */
  reservationTtlSec: number
  /** Orders may never be discounted below max(floor, ceil(total * ratio)). */
  minChargeFloorCents: Cents
  minChargeRatioBps: number
  /** Smallest priority purchase the payment rail accepts (Stripe USD: 50¢). */
  paymentMinimumCents: Cents
}

export interface ConsentPolicy {
  /** Explicit opt-in to being overtaken. Defaults to false. */
  optIn: boolean
  /** Price this party charges for each single displacement. */
  minCompensationCents: Cents
  /** Maximum cumulative additional waiting time this party accepts. */
  maxAdditionalDelaySec: number
  updatedAt: number
}

export interface OrderItem {
  sku: string
  name: string
  cents: Cents
}

export type OrderPayment =
  | { kind: 'none' }
  | {
      kind: 'simulated'
      status: 'authorized' | 'captured' | 'canceled'
      authorizedCents: Cents
      capturedCents?: Cents
    }
  | {
      kind: 'stripe'
      status: 'pending' | 'authorized' | 'capture_pending' | 'captured' | 'capture_failed' | 'canceled' | 'failed'
      authorizedCents: Cents
      checkoutSessionId?: string
      paymentIntentId?: string
      capturedCents?: Cents
      /** Epoch ms after which the authorization can no longer be captured. */
      captureBefore?: number
      lastError?: string
      /** True when the authorization was created server-side with a Stripe test card during seeding. */
      seeded?: boolean
    }

export type PartyStatus = 'waiting' | 'serving' | 'served' | 'left'

export interface Party {
  id: string
  displayName: string
  orderItems: OrderItem[]
  orderTotalCents: Cents
  minChargeCents: Cents
  /** Expected service duration for this party's order. */
  serviceSec: number
  joinedAt: number
  status: PartyStatus
  consent: ConsentPolicy
  /** Cumulative delay this party has accepted through confirmed exchanges. */
  addedDelaySec: number
  earnedDiscountCents: Cents
  /** Exchange currently reserving this party, if any. */
  lockedBy: string | null
  payment: OrderPayment
  /** Seeded demo party, not a real customer. */
  seeded: boolean
  servingStartedAt?: number
  servedAt?: number
  finalChargeCents?: Cents
  /** SHA-256 of the party's session token. Never leaves the server. */
  tokenHash: string | null
}

export interface ConsentSnapshot {
  optIn: boolean
  minCompensationCents: Cents
  maxAdditionalDelaySec: number
  updatedAt: number
}

export interface AffectedParty {
  partyId: string
  displayName: string
  position: number
  compensationCents: Cents
  additionalDelaySec: number
  cumulativeDelayAfterSec: number
  consent: ConsentSnapshot
  /** Order total after this exchange's discount. */
  orderTotalAfterCents: Cents
}

export interface Quote {
  id: string
  venueId: string
  requesterId: string
  queueVersion: number
  fromPosition: number
  targetPosition: number
  affected: AffectedParty[]
  compensationTotalCents: Cents
  merchantFeeCents: Cents
  totalCents: Cents
  timeSavedSec: number
  currency: 'usd'
  issuedAt: number
  expiresAt: number
}

export type ExchangeStatus = 'pending' | 'confirmed' | 'released' | 'refunded'

export type ReleaseReason =
  | 'payment_failed'
  | 'cancelled'
  | 'expired'
  | 'checkout_error'
  | 'merchant_cancelled'

export interface ExchangePayment {
  provider: 'stripe' | 'simulated'
  status: 'creating' | 'open' | 'paid' | 'expired' | 'failed' | 'refunded'
  amountCents: Cents
  sessionId?: string
  paymentIntentId?: string
  refundId?: string
}

export interface ExchangeEvent {
  at: number
  type: string
  detail?: string
}

export interface Exchange {
  id: string
  venueId: string
  quote: Quote
  status: ExchangeStatus
  createdAt: number
  /** Reservation expiry. After this the payment session is expired and positions released. */
  reservationExpiresAt: number
  payment: ExchangePayment
  confirmedAt?: number
  releasedAt?: number
  releaseReason?: ReleaseReason
  /** Queue version immediately after finalization. */
  appliedQueueVersion?: number
  events: ExchangeEvent[]
}

export type LedgerKind =
  | 'priority_premium'
  | 'customer_compensation'
  | 'merchant_fee'
  | 'priority_refund'
  | 'order_authorization'
  | 'order_capture'
  | 'compensation_forfeited'

export interface LedgerEntry {
  id: string
  at: number
  kind: LedgerKind
  /** Always non-negative; the kind gives the direction. See reconcile.ts for the invariants. */
  amountCents: Cents
  provider: 'stripe' | 'simulated' | 'none'
  exchangeId?: string
  partyId?: string
  providerRef?: string
  memo: string
}

export interface SimulatedSession {
  id: string
  purpose: 'priority'
  exchangeId: string
  partyId: string
  amountCents: Cents
  status: 'open' | 'paid' | 'declined' | 'expired'
  createdAt: number
  expiresAt: number
}

export interface VenueState {
  config: VenueConfig
  /** Bumped on every change that could alter a quote: order, membership, consent, locks. */
  queueVersion: number
  /** Party ids that are waiting or serving, in queue order. Index 0 is position 1. */
  queue: string[]
  parties: Record<string, Party>
  quotes: Record<string, Quote>
  exchanges: Record<string, Exchange>
  ledger: LedgerEntry[]
  /** Stripe event ids already processed, newest last. */
  processedEvents: string[]
  simulatedSessions: Record<string, SimulatedSession>
  seededAt: number
}
