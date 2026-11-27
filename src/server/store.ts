import { ok, type Result } from '@/domain/result'
import type { VenueState } from '@/domain/types'

/**
 * A venue is one aggregate stored under one key with a revision number.
 * Every write is an atomic compare-and-set on that revision, so two devices
 * acting at once can never both commit against the same version.
 */
export interface Store {
  readonly kind: 'redis' | 'memory'
  read(venueId: string): Promise<{ rev: number; state: VenueState } | null>
  /** Writes only if the stored revision still equals `expectedRev`. */
  cas(venueId: string, expectedRev: number, state: VenueState): Promise<boolean>
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const
  private readonly data = new Map<string, { rev: number; state: VenueState }>()

  async read(venueId: string) {
    return this.data.get(venueId) ?? null
  }

  async cas(venueId: string, expectedRev: number, state: VenueState) {
    // No await between check and write: atomic on Node's single thread.
    if ((this.data.get(venueId)?.rev ?? 0) !== expectedRev) return false
    this.data.set(venueId, { rev: expectedRev + 1, state: structuredClone(state) })
    return true
  }
}

const CAS_SCRIPT = `local r = tonumber(redis.call('GET', KEYS[2]) or '0')
if r ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], tostring(r + 1))
return 1`

/** Upstash Redis over its REST API. The Lua script runs atomically inside Redis. */
export class RedisStore implements Store {
  readonly kind = 'redis' as const
  constructor(private readonly url: string, private readonly token: string) {}

  private keys(venueId: string) {
    return [`chronos:${venueId}:state`, `chronos:${venueId}:rev`] as const
  }

  private async command<T>(command: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      cache: 'no-store',
    })
    const body = (await res.json()) as { result?: T; error?: string }
    if (!res.ok || body.error) throw new Error(`Redis error: ${body.error ?? res.status}`)
    return body.result as T
  }

  async read(venueId: string) {
    const [stateKey, revKey] = this.keys(venueId)
    const [state, rev] = await this.command<[string | null, string | null]>(['MGET', stateKey, revKey])
    return state ? { rev: Number(rev ?? 0), state: JSON.parse(state) as VenueState } : null
  }

  async cas(venueId: string, expectedRev: number, state: VenueState) {
    const [stateKey, revKey] = this.keys(venueId)
    return (await this.command<number>(['EVAL', CAS_SCRIPT, 2, stateKey, revKey, expectedRev, JSON.stringify(state)])) === 1
  }
}

export async function readOrSeed(store: Store, venueId: string, seed: () => VenueState) {
  const current = await store.read(venueId)
  if (current) return current
  await store.cas(venueId, 0, seed())
  const after = await store.read(venueId)
  if (!after) throw new Error('Could not initialise venue state')
  return after
}

/**
 * Read → pure mutator → compare-and-set, retried if another writer won.
 * The mutator re-validates everything against the fresh state on each attempt.
 * Never call an external service (Stripe) inside a mutator.
 */
export async function mutate<T>(
  store: Store,
  venueId: string,
  seed: () => VenueState,
  mutator: (s: VenueState) => Result<{ state: VenueState; value: T }>,
): Promise<Result<{ state: VenueState; value: T }>> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { rev, state } = await readOrSeed(store, venueId, seed)
    const result = mutator(state)
    if (!result.ok) return result
    if (result.value.state === state) return ok(result.value)
    if (await store.cas(venueId, rev, result.value.state)) return ok(result.value)
    await new Promise((r) => setTimeout(r, 10 * (attempt + 1)))
  }
  throw new Error('The queue is busy. Please try again.')
}
