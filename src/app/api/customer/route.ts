import { z } from 'zod'
import { menuItem } from '@/domain/demo'
import { clearPartyToken, currentPartyId, setPartyToken } from '@/server/auth'
import { fail, json } from '@/server/http'
import { originOf, runtime } from '@/server/runtime'

export const dynamic = 'force-dynamic'

const consent = z.object({
  optIn: z.boolean(),
  minCompensationCents: z.number().int().min(25).max(500),
  maxAdditionalDelaySec: z.number().int().min(0).max(1800),
})

const body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('join'),
    name: z.string().trim().min(1).max(24),
    sku: z.string().refine((s) => Boolean(menuItem(s)), 'Unknown menu item'),
    consent,
    payWithCard: z.boolean().default(false),
  }),
  z.object({ action: z.literal('consent'), consent }),
  z.object({ action: z.literal('leave') }),
  z.object({ action: z.literal('quote'), target: z.number().int().min(1).max(50) }),
  z.object({ action: z.literal('purchase'), quoteId: z.string().max(80) }),
  z.object({ action: z.literal('reconcile'), exchangeId: z.string().max(80) }),
  z.object({ action: z.literal('cancel'), exchangeId: z.string().max(80) }),
  z.object({ action: z.literal('simulatedCheckout'), sessionId: z.string().max(80), outcome: z.enum(['paid', 'declined']) }),
  z.object({ action: z.literal('refreshAuthorization') }),
])

/** Who am I? Resolves the caller's party from their httpOnly session cookie. */
export async function GET() {
  const state = await runtime().chronos.load()
  const partyId = await currentPartyId(state)
  const active = partyId && state.parties[partyId]?.status !== 'left' ? partyId : null
  return json({ partyId: active })
}

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid request', 400)
  const input = parsed.data
  const { chronos } = runtime()

  if (input.action === 'join') {
    const r = await chronos.join(input, originOf(request))
    if (!r.ok) return fail(r.error)
    await setPartyToken(r.value.token)
    return json({ partyId: r.value.partyId, authorizationUrl: r.value.authorizationUrl })
  }

  const partyId = await currentPartyId(await chronos.load())
  if (!partyId) return fail('Your session has ended. Please join the queue again.', 401)

  switch (input.action) {
    case 'consent': {
      const r = await chronos.updateConsent(partyId, input.consent)
      return r.ok ? json({ ok: true }) : fail(r.error)
    }
    case 'leave': {
      const r = await chronos.leave(partyId)
      if (r.ok) await clearPartyToken()
      return r.ok ? json({ ok: true }) : fail(r.error)
    }
    case 'quote': {
      const r = await chronos.quote(partyId, input.target)
      return r.ok ? json({ quote: r.value }) : fail(r.error)
    }
    case 'purchase': {
      const r = await chronos.purchase(partyId, input.quoteId, originOf(request))
      return r.ok ? json(r.value) : fail(r.error)
    }
    case 'reconcile': {
      const ex = (await chronos.load()).exchanges[input.exchangeId]
      if (!ex || ex.quote.requesterId !== partyId) return fail('Exchange not found', 404)
      const r = await chronos.reconcileExchange(input.exchangeId)
      return r.ok ? json({ status: r.value.status }) : fail(r.error)
    }
    case 'cancel': {
      const r = await chronos.cancelExchange(input.exchangeId, { partyId })
      return r.ok ? json({ status: r.value.status }) : fail(r.error)
    }
    case 'simulatedCheckout': {
      const r = await chronos.resolveSimulated(input.sessionId, partyId, input.outcome)
      return r.ok ? json({ status: r.value.status }) : fail(r.error)
    }
    case 'refreshAuthorization': {
      await chronos.reconcileOrderAuthorization(partyId)
      return json({ ok: true })
    }
  }
}
