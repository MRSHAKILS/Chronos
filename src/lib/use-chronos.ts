'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEMO_PARTIES, demoVenueConfig, menuItem } from '@/domain/demo'
import { finalizeExchange, releaseExchange, reserveExchange } from '@/domain/exchange'
import { callNext, completeService, createVenueState, joinQueue, type Ids } from '@/domain/queue'
import { issueQuote } from '@/domain/quote'
import type { Quote, VenueState } from '@/domain/types'

const KEY = 'chronos-demo-state'
let counter = Date.now()
const ids: Ids = { next: (p) => `${p}_${(++counter).toString(36)}` }

export function seedState(): VenueState {
  let s = createVenueState(demoVenueConfig(), Date.now())
  for (const p of DEMO_PARTIES) {
    const item = menuItem(p.sku)!
    const r = joinQueue(
      s,
      {
        partyId: p.displayName.toLowerCase(),
        displayName: p.displayName,
        orderItems: [{ sku: item.sku, name: item.name, cents: item.cents }],
        serviceSec: item.serviceSec,
        consent: p.consent,
        payment: { kind: 'simulated', status: 'authorized', authorizedCents: item.cents },
        tokenHash: null,
        seeded: true,
      },
      Date.now(),
    )
    if (r.ok) s = r.value.state
  }
  return s
}

/** Demo state lives in localStorage and syncs across tabs (display / phone / merchant). */
export function useChronos() {
  const [state, setState] = useState<VenueState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const raw = localStorage.getItem(KEY)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(raw ? (JSON.parse(raw) as VenueState) : seedState())
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) setState(JSON.parse(e.newValue) as VenueState)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const commit = useCallback((next: VenueState) => {
    localStorage.setItem(KEY, JSON.stringify(next))
    setState(next)
  }, [])

  const run = useCallback(
    <T,>(fn: (s: VenueState) => { ok: true; value: { state: VenueState } & T } | { ok: false; error: { message: string } }) => {
      if (!state) return null
      const r = fn(state)
      if (!r.ok) {
        setMessage(r.error.message)
        return null
      }
      setMessage(null)
      commit(r.value.state)
      return r.value
    },
    [state, commit],
  )

  const actions = {
    reset: () => commit(seedState()),
    joinDaniel: () => {
      const item = menuItem('cold-brew')!
      run((s) =>
        joinQueue(
          s,
          {
            partyId: 'daniel',
            displayName: 'Daniel',
            orderItems: [{ sku: item.sku, name: item.name, cents: item.cents }],
            serviceSec: item.serviceSec,
            consent: { optIn: false, minCompensationCents: 50, maxAdditionalDelaySec: 0 },
            payment: { kind: 'simulated', status: 'authorized', authorizedCents: item.cents },
            tokenHash: null,
          },
          Date.now(),
        ),
      )
    },
    quote: (partyId: string, target: number): Quote | null =>
      run((s) => issueQuote(s, partyId, target, Date.now(), ids))?.quote ?? null,
    /** Simulated checkout: reserve → pay → finalize, through the real engine. */
    pay: (quote: Quote) => {
      if (!state) return
      const r = reserveExchange(state, { quoteId: quote.id, requesterId: quote.requesterId, provider: 'simulated' }, Date.now(), ids)
      if (!r.ok) return setMessage(r.error.message)
      const f = finalizeExchange(
        r.value.state,
        r.value.exchange.id,
        { provider: 'simulated', amountCents: quote.totalCents, currency: 'usd', sessionId: `sim_${r.value.exchange.id}` },
        Date.now(),
        ids,
      )
      if (!f.ok) {
        const rel = releaseExchange(r.value.state, r.value.exchange.id, 'payment_failed', Date.now())
        if (rel.ok) commit(rel.value.state)
        return setMessage(f.error.message)
      }
      setMessage(null)
      commit(f.value.state)
    },
    serveNext: () => {
      if (!state) return
      const serving = state.queue.find((id) => state.parties[id]?.status === 'serving')
      if (serving) run((s) => completeService(s, serving, Date.now()))
      else run((s) => callNext(s, Date.now()))
    },
  }

  return { state, message, actions }
}
