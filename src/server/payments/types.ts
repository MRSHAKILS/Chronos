export type PaymentMode = 'stripe_sandbox' | 'simulation'

export interface CheckoutStatus {
  sessionId: string
  state: 'open' | 'paid' | 'expired' | 'unpaid'
  amountCents: number
  currency: string
  paymentIntentId?: string
  /** Exchange id from trusted provider-side metadata. */
  exchangeId?: string
}

export interface OrderAuthorizationStatus {
  paymentIntentId?: string
  state: 'pending' | 'authorized' | 'failed' | 'canceled' | 'captured'
  amountCapturableCents: number
  /** Epoch ms after which the authorization can no longer be captured. */
  captureBefore?: number
}

export interface PriorityCheckoutInput {
  venueId: string
  exchangeId: string
  requesterId: string
  amountCents: number
  title: string
  description: string
  successUrl: string
  cancelUrl: string
  /** Epoch ms. Stripe enforces a 30-minute minimum, so we also expire sessions explicitly. */
  reservationExpiresAt: number
}

/**
 * What CHRONOS needs from a payment rail. The Stripe adapter talks to Stripe's
 * sandbox. The simulation adapter is an explicitly labelled stand-in that never
 * moves money but goes through exactly the same lifecycle.
 */
export interface PaymentAdapter {
  readonly mode: PaymentMode
  createPriorityCheckout(input: PriorityCheckoutInput): Promise<{ sessionId: string; url: string | null }>
  getPriorityCheckout(sessionId: string): Promise<CheckoutStatus>
  /** Closes an open session and returns its state afterwards (which may be `paid` if payment raced). */
  expirePriorityCheckout(sessionId: string): Promise<CheckoutStatus>
  refundPriority(paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<{ refundId: string }>

  /** Order authorization with manual capture (Stripe only). */
  createOrderAuthorization?(input: {
    venueId: string
    partyId: string
    amountCents: number
    title: string
    successUrl: string
    cancelUrl: string
  }): Promise<{ sessionId: string; url: string }>
  getOrderAuthorizationFromSession?(sessionId: string): Promise<OrderAuthorizationStatus>
  getOrderAuthorization?(paymentIntentId: string): Promise<OrderAuthorizationStatus>
  captureOrder?(paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<{ capturedCents: number }>
}
