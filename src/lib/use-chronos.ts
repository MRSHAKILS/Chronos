'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExchangeReconciliation, VenueTotals } from '@/domain/reconcile'
import type { Quote, VenueState } from '@/domain/types'

export interface Mode {
  store: 'redis' | 'memory'
  payments: 'stripe_sandbox' | 'simulation'
}

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json()) as T & { error?: string }
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? 'Something went wrong' }
  } catch {
    return { ok: false, error: 'Network error, please try again' }
  }
}

/** Polls the shared public venue state once a second. */
export function useVenue() {
  const [state, setState] = useState<VenueState | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as { state: VenueState; mode: Mode }
      setState(body.state)
      setMode(body.mode)
    } catch {
      // Next poll retries.
    }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const t = setInterval(refresh, 1000)
    return () => clearInterval(t)
  }, [refresh])
  return { state, mode, refresh }
}

export type JoinInput = {
  name: string
  sku: string
  consent: { optIn: boolean; minCompensationCents: number; maxAdditionalDelaySec: number }
  payWithCard: boolean
}

export type PurchaseResult = { exchangeId: string; sessionId: string; url: string | null; amountCents: number; mode: Mode['payments'] }

/** The signed-in customer (httpOnly cookie session) and their actions. */
export function useCustomer(onChange: () => void) {
  const [partyId, setPartyId] = useState<string | null | undefined>(undefined)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const loadMe = useCallback(async () => {
    const res = await fetch('/api/customer', { cache: 'no-store' })
    const body = (await res.json()) as { partyId: string | null }
    setPartyId(body.partyId)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMe()
  }, [loadMe])

  const call = useCallback(
    async <T,>(body: Record<string, unknown>): Promise<T | null> => {
      if (busyRef.current) return null
      busyRef.current = true
      setBusy(true)
      const r = await post<T>('/api/customer', body)
      busyRef.current = false
      setBusy(false)
      if (!r.ok) {
        setMessage(r.error)
        if (r.error.includes('session has ended')) setPartyId(null)
        return null
      }
      setMessage(null)
      onChange()
      return r.data
    },
    [onChange],
  )

  return {
    partyId,
    message,
    busy,
    setMessage,
    join: async (input: JoinInput) => {
      const r = await call<{ partyId: string; authorizationUrl: string | null }>({ action: 'join', ...input })
      if (r) setPartyId(r.partyId)
      return r
    },
    updateConsent: (consent: JoinInput['consent']) => call({ action: 'consent', consent }),
    leave: async () => {
      if (await call({ action: 'leave' })) setPartyId(null)
    },
    quote: async (target: number) => (await call<{ quote: Quote }>({ action: 'quote', target }))?.quote ?? null,
    purchase: (quoteId: string) => call<PurchaseResult>({ action: 'purchase', quoteId }),
    reconcile: (exchangeId: string) => call<{ status: string }>({ action: 'reconcile', exchangeId }),
    cancel: (exchangeId: string) => call<{ status: string }>({ action: 'cancel', exchangeId }),
    simulatedCheckout: (sessionId: string, outcome: 'paid' | 'declined') =>
      call<{ status: string }>({ action: 'simulatedCheckout', sessionId, outcome }),
    refreshAuthorization: () => call({ action: 'refreshAuthorization' }),
  }
}

export interface MerchantData {
  authenticated: boolean
  demoPasscode?: string | null
  state?: VenueState
  totals?: VenueTotals
  reconciliation?: ExchangeReconciliation[]
  mode?: Mode
}

/** Merchant console data (requires the merchant session cookie). */
export function useMerchant() {
  const [data, setData] = useState<MerchantData | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/merchant', { cache: 'no-store' })
      setData((await res.json()) as MerchantData)
    } catch {
      // Next poll retries.
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const t = setInterval(refresh, 1500)
    return () => clearInterval(t)
  }, [refresh])

  const act = async (body: Record<string, unknown>) => {
    setBusy(true)
    const r = await post('/api/merchant', body)
    setBusy(false)
    setMessage(r.ok ? null : r.error)
    await refresh()
    return r.ok
  }

  return {
    data,
    message,
    busy,
    login: (passcode: string) => act({ action: 'login', passcode }),
    logout: () => act({ action: 'logout' }),
    serveNext: () => act({ action: 'serveNext' }),
    reset: () => act({ action: 'reset' }),
    cancelExchange: (exchangeId: string) => act({ action: 'cancelExchange', exchangeId }),
    reconcileExchange: (exchangeId: string) => act({ action: 'reconcileExchange', exchangeId }),
    retryCapture: (partyId: string) => act({ action: 'retryCapture', partyId }),
  }
}
