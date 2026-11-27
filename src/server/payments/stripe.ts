import Stripe from 'stripe'
import type { CheckoutStatus, OrderAuthorizationStatus, PaymentAdapter, PriorityCheckoutInput } from './types'

/** Stripe requires Checkout sessions to live at least 30 minutes. */
const STRIPE_MIN_SESSION_SEC = 31 * 60

export function assertSandboxKey(secretKey: string) {
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('rk_test_')) {
    throw new Error('CHRONOS only runs against the Stripe sandbox. STRIPE_SECRET_KEY must be a test-mode key.')
  }
}

export class StripeAdapter implements PaymentAdapter {
  readonly mode = 'stripe_sandbox' as const
  readonly stripe: Stripe

  constructor(secretKey: string) {
    assertSandboxKey(secretKey)
    this.stripe = new Stripe(secretKey, { appInfo: { name: 'CHRONOS' } })
  }

  async createPriorityCheckout(input: PriorityCheckoutInput) {
    const expiresAt = Math.max(Math.floor(input.reservationExpiresAt / 1000), Math.floor(Date.now() / 1000) + STRIPE_MIN_SESSION_SEC)
    const metadata = { chronos_kind: 'priority', venue_id: input.venueId, exchange_id: input.exchangeId, party_id: input.requesterId }
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: input.amountCents,
              product_data: { name: input.title, description: input.description },
            },
          },
        ],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: expiresAt,
        client_reference_id: input.exchangeId,
        metadata,
        payment_intent_data: { metadata },
      },
      { idempotencyKey: `chronos-priority-${input.exchangeId}` },
    )
    if (!session.url) throw new Error('Stripe did not return a Checkout URL')
    return { sessionId: session.id, url: session.url }
  }

  private toStatus(session: Stripe.Checkout.Session): CheckoutStatus {
    const pi = session.payment_intent
    let state: CheckoutStatus['state'] = 'open'
    if (session.status === 'complete') state = session.payment_status === 'paid' ? 'paid' : 'unpaid'
    else if (session.status === 'expired') state = 'expired'
    return {
      sessionId: session.id,
      state,
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      paymentIntentId: (typeof pi === 'string' ? pi : pi?.id) ?? undefined,
      exchangeId: session.metadata?.exchange_id ?? undefined,
    }
  }

  async getPriorityCheckout(sessionId: string) {
    return this.toStatus(await this.stripe.checkout.sessions.retrieve(sessionId))
  }

  async expirePriorityCheckout(sessionId: string) {
    try {
      return this.toStatus(await this.stripe.checkout.sessions.expire(sessionId))
    } catch {
      // Already complete or expired: report the authoritative state.
      return this.getPriorityCheckout(sessionId)
    }
  }

  async refundPriority(paymentIntentId: string, amountCents: number, idempotencyKey: string) {
    const refund = await this.stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents }, { idempotencyKey })
    return { refundId: refund.id }
  }

  async createOrderAuthorization(input: {
    venueId: string
    partyId: string
    amountCents: number
    title: string
    successUrl: string
    cancelUrl: string
  }) {
    const metadata = { chronos_kind: 'order', venue_id: input.venueId, party_id: input.partyId }
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: input.amountCents, product_data: { name: input.title } } }],
        payment_intent_data: { capture_method: 'manual', metadata },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata,
      },
      { idempotencyKey: `chronos-order-${input.partyId}` },
    )
    if (!session.url) throw new Error('Stripe did not return a Checkout URL')
    return { sessionId: session.id, url: session.url }
  }

  private async describe(pi: Stripe.PaymentIntent): Promise<OrderAuthorizationStatus> {
    const charge = typeof pi.latest_charge === 'string' ? await this.stripe.charges.retrieve(pi.latest_charge) : pi.latest_charge
    const captureBefore = charge?.payment_method_details?.card?.capture_before
    const map: Partial<Record<Stripe.PaymentIntent.Status, OrderAuthorizationStatus['state']>> = {
      requires_capture: 'authorized',
      succeeded: 'captured',
      canceled: 'canceled',
      requires_payment_method: 'failed',
    }
    return {
      paymentIntentId: pi.id,
      state: map[pi.status] ?? 'pending',
      amountCapturableCents: pi.amount_capturable,
      captureBefore: captureBefore ? captureBefore * 1000 : undefined,
    }
  }

  async getOrderAuthorizationFromSession(sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] })
    const pi = session.payment_intent
    if (!pi || typeof pi === 'string') return { state: session.status === 'expired' ? 'failed' : 'pending', amountCapturableCents: 0 } as const
    return this.describe(pi)
  }

  async getOrderAuthorization(paymentIntentId: string) {
    return this.describe(await this.stripe.paymentIntents.retrieve(paymentIntentId))
  }

  async captureOrder(paymentIntentId: string, amountCents: number, idempotencyKey: string) {
    const pi = await this.stripe.paymentIntents.capture(paymentIntentId, { amount_to_capture: amountCents }, { idempotencyKey })
    return { capturedCents: pi.amount_received }
  }
}
