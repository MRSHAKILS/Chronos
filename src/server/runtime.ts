import 'server-only'
import { DEMO_VENUE_ID } from '@/domain/demo'
import type { Ids } from '@/domain/queue'
import type { VenueState } from '@/domain/types'
import { createChronos, type Chronos } from './lifecycle'
import { SimulatedAdapter } from './payments/simulated'
import { StripeAdapter } from './payments/stripe'
import { seedState } from './seed'
import { MemoryStore, RedisStore, type Store } from './store'

const ids: Ids = { next: (p) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}` }

interface Runtime {
  chronos: Chronos
  store: Store
  stripe: StripeAdapter | null
}

const g = globalThis as unknown as { __chronosRuntime?: Runtime }

/** Builds the service once per server instance from environment variables. Secrets never reach the browser. */
export function runtime(): Runtime {
  if (g.__chronosRuntime) return g.__chronosRuntime
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  const store: Store = url && token ? new RedisStore(url, token) : new MemoryStore()
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  const stripe = key ? new StripeAdapter(key) : null
  const now = () => Date.now()
  const payments =
    stripe ?? new SimulatedAdapter(store, DEMO_VENUE_ID, () => seedState(now()), now, () => crypto.randomUUID().replace(/-/g, ''))
  g.__chronosRuntime = { chronos: createChronos({ store, payments, venueId: DEMO_VENUE_ID, now, ids }), store, stripe }
  return g.__chronosRuntime
}

export function modeInfo() {
  const r = runtime()
  return { store: r.store.kind, payments: r.stripe ? ('stripe_sandbox' as const) : ('simulation' as const) }
}

/** Strips anything private before state leaves the server. */
export function publicState(state: VenueState): VenueState {
  const parties = Object.fromEntries(Object.entries(state.parties).map(([id, p]) => [id, { ...p, tokenHash: null }]))
  return { ...state, parties, quotes: {}, simulatedSessions: {}, processedEvents: [] }
}

export function originOf(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, '')
  if (configured) return configured
  const u = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? u.host
  const proto = request.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '')
  return `${proto}://${host}`
}
