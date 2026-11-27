import { fail, json } from '@/server/http'
import { runtime } from '@/server/runtime'

export const dynamic = 'force-dynamic'

/** Stripe webhook: verifies the signature on the raw body, then reconciles idempotently. */
export async function POST(request: Request) {
  const { stripe, chronos } = runtime()
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!stripe || !secret) return fail('Stripe webhooks are not configured', 404)
  const signature = request.headers.get('stripe-signature')
  if (!signature) return fail('Missing signature', 400)
  const raw = await request.text()
  let event
  try {
    event = stripe.stripe.webhooks.constructEvent(raw, signature, secret)
  } catch {
    return fail('Invalid signature', 400)
  }
  const result = await chronos.handleStripeEvent(event as unknown as Parameters<typeof chronos.handleStripeEvent>[0])
  return json({ received: true, duplicate: result.duplicate })
}
