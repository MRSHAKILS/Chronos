'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quote, VenueState } from '@/domain/types'

type Action =
  | { type: 'reset' }
  | { type: 'joinDaniel' }
  | { type: 'quote'; partyId: string; target: number }
  | { type: 'pay'; quoteId: string; partyId: string }
  | { type: 'serveNext' }

/**
 * Shared venue state, held on the server. Every screen polls once a second,
 * so a phone, the big display and the merchant console all see the same queue.
 */
export function useChronos() {
  const [state, setState] = useState<VenueState | null>(null)
  const [store, setStore] = useState<'redis' | 'memory' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    if (busyRef.current) return
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as { state: VenueState; store: 'redis' | 'memory' }
      if (!busyRef.current) {
        setState(body.state)
        setStore(body.store)
      }
    } catch {
      // Offline for a moment; the next poll retries.
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const t = setInterval(refresh, 1000)
    return () => clearInterval(t)
  }, [refresh])

  const send = useCallback(async (action: Action): Promise<Quote | null> => {
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      })
      const body = (await res.json()) as { state?: VenueState; quote?: Quote | null; error?: string }
      if (!res.ok) {
        setMessage(body.error ?? 'Something went wrong')
        return null
      }
      setMessage(null)
      if (body.state) setState(body.state)
      return body.quote ?? null
    } catch {
      setMessage('Network error, please try again')
      return null
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const actions = {
    reset: () => void send({ type: 'reset' }),
    joinDaniel: () => void send({ type: 'joinDaniel' }),
    quote: (partyId: string, target: number) => send({ type: 'quote', partyId, target }),
    pay: (quote: Quote) => void send({ type: 'pay', quoteId: quote.id, partyId: quote.requesterId }),
    serveNext: () => void send({ type: 'serveNext' }),
  }

  return { state, store, message, busy, actions }
}
