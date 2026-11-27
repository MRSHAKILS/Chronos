import { DEMO_PARTIES, demoVenueConfig, menuItem } from '@/domain/demo'
import { finalizeExchange, releaseExchange, reserveExchange } from '@/domain/exchange'
import { callNext, completeService, createVenueState, joinQueue, type Ids } from '@/domain/queue'
import { issueQuote } from '@/domain/quote'
import { err, ok, type Result } from '@/domain/result'
import type { Quote, VenueState } from '@/domain/types'
import { z } from 'zod'

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reset') }),
  z.object({ type: z.literal('joinDaniel') }),
  z.object({ type: z.literal('quote'), partyId: z.string().max(40), target: z.number().int().min(1).max(50) }),
  z.object({ type: z.literal('pay'), quoteId: z.string().max(60), partyId: z.string().max(40) }),
  z.object({ type: z.literal('serveNext') }),
])
export type Action = z.infer<typeof actionSchema>

export function makeIds(): Ids {
  return { next: (p) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}` }
}

function join(s: VenueState, id: string, name: string, sku: string, consent: VenueState['parties'][string]['consent'], seeded: boolean, now: number) {
  const item = menuItem(sku)!
  return joinQueue(
    s,
    {
      partyId: id,
      displayName: name,
      orderItems: [{ sku: item.sku, name: item.name, cents: item.cents }],
      serviceSec: item.serviceSec,
      consent,
      payment: { kind: 'simulated', status: 'authorized', authorizedCents: item.cents },
      tokenHash: null,
      seeded,
    },
    now,
  )
}

export function seedState(now: number): VenueState {
  let s = createVenueState(demoVenueConfig(), now)
  for (const p of DEMO_PARTIES) {
    const r = join(s, p.displayName.toLowerCase(), p.displayName, p.sku, { ...p.consent, updatedAt: now }, true, now)
    if (r.ok) s = r.value.state
  }
  return s
}

/** Applies one demo action through the domain engine. Pure: the store makes it atomic. */
export function applyAction(state: VenueState, action: Action, now: number, ids: Ids): Result<{ state: VenueState; value: { quote?: Quote } }> {
  switch (action.type) {
    case 'reset':
      return ok({ state: seedState(now), value: {} })
    case 'joinDaniel': {
      const r = join(state, 'daniel', 'Daniel', 'cold-brew', { optIn: false, minCompensationCents: 50, maxAdditionalDelaySec: 0, updatedAt: now }, false, now)
      return r.ok ? ok({ state: r.value.state, value: {} }) : r
    }
    case 'quote': {
      const r = issueQuote(state, action.partyId, action.target, now, ids)
      return r.ok ? ok({ state: r.value.state, value: { quote: r.value.quote } }) : r
    }
    case 'pay': {
      // SIMULATED payment: reserve → (simulated success) → finalize, in one atomic step.
      const r = reserveExchange(state, { quoteId: action.quoteId, requesterId: action.partyId, provider: 'simulated' }, now, ids)
      if (!r.ok) return r
      const { exchange } = r.value
      const f = finalizeExchange(
        r.value.state,
        exchange.id,
        { provider: 'simulated', amountCents: exchange.quote.totalCents, currency: 'usd', sessionId: `sim_${exchange.id}` },
        now,
        ids,
      )
      if (f.ok) return ok({ state: f.value.state, value: {} })
      const rel = releaseExchange(r.value.state, exchange.id, 'payment_failed', now)
      return rel.ok ? err(f.error.code, f.error.message) : rel
    }
    case 'serveNext': {
      const serving = state.queue.find((id) => state.parties[id]?.status === 'serving')
      const r = serving ? completeService(state, serving, now) : callNext(state, now)
      return r.ok ? ok({ state: r.value.state, value: {} }) : r
    }
  }
}
