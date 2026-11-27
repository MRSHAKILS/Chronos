import { clone } from '@/domain/queue'
import { err, ok } from '@/domain/result'
import type { VenueState } from '@/domain/types'
import { mutate, readOrSeed, type Store } from '../store'
import type { CheckoutStatus, PaymentAdapter, PriorityCheckoutInput } from './types'

/**
 * SIMULATION ADAPTER: no money moves and nothing is sent to any provider.
 * Sessions live in the venue aggregate, so they are as durable as the queue.
 * The customer approves or declines in an in-app sheet, and that outcome flows
 * through the same reconciliation path a Stripe payment would.
 */
export class SimulatedAdapter implements PaymentAdapter {
  readonly mode = 'simulation' as const

  constructor(
    private readonly store: Store,
    private readonly venueId: string,
    private readonly seed: () => VenueState,
    private readonly now: () => number,
    private readonly randomId: () => string,
  ) {}

  async createPriorityCheckout(input: PriorityCheckoutInput) {
    const sessionId = `simcs_${this.randomId()}`
    const r = await mutate(this.store, this.venueId, this.seed, (state) => {
      const next = clone(state)
      next.simulatedSessions[sessionId] = {
        id: sessionId,
        purpose: 'priority',
        exchangeId: input.exchangeId,
        partyId: input.requesterId,
        amountCents: input.amountCents,
        status: 'open',
        createdAt: this.now(),
        expiresAt: input.reservationExpiresAt,
      }
      return ok({ state: next, value: sessionId })
    })
    if (!r.ok) throw new Error(r.error.message)
    return { sessionId, url: null }
  }

  async getPriorityCheckout(sessionId: string): Promise<CheckoutStatus> {
    const { state } = await readOrSeed(this.store, this.venueId, this.seed)
    const s = state.simulatedSessions[sessionId]
    if (!s) throw new Error('Simulated session not found')
    return {
      sessionId,
      state: s.status === 'paid' ? 'paid' : s.status === 'open' ? 'open' : s.status === 'declined' ? 'unpaid' : 'expired',
      amountCents: s.amountCents,
      currency: 'usd',
      paymentIntentId: s.status === 'paid' ? `simpi_${sessionId.slice(6)}` : undefined,
      exchangeId: s.exchangeId,
    }
  }

  async expirePriorityCheckout(sessionId: string) {
    await mutate(this.store, this.venueId, this.seed, (state) => {
      const s = state.simulatedSessions[sessionId]
      if (!s || s.status !== 'open') return ok({ state, value: null })
      const next = clone(state)
      next.simulatedSessions[sessionId]!.status = 'expired'
      return ok({ state: next, value: null })
    })
    return this.getPriorityCheckout(sessionId)
  }

  async refundPriority(paymentIntentId: string) {
    return { refundId: `simre_${paymentIntentId.slice(-12)}` }
  }

  /** The customer's answer in the simulated checkout sheet. Only the session owner can resolve it. */
  resolve(sessionId: string, partyId: string, outcome: 'paid' | 'declined') {
    return mutate(this.store, this.venueId, this.seed, (state) => {
      const s = state.simulatedSessions[sessionId]
      if (!s || s.partyId !== partyId) return err('not_found', 'Checkout session not found')
      if (s.status !== 'open') return ok({ state, value: s.status })
      const next = clone(state)
      next.simulatedSessions[sessionId]!.status = this.now() > s.expiresAt ? 'expired' : outcome
      return ok({ state: next, value: next.simulatedSessions[sessionId]!.status })
    })
  }
}
