import 'server-only'
import { ok, type Result } from '@/domain/result'
import type { VenueState } from '@/domain/types'

/**
 * Shared venue state.
 * - Upstash Redis (REST) when KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN are set:
 *   every write is an atomic compare-and-set on a revision number (Lua script), so
 *   two devices acting at once can never both commit against the same version.
 * - Otherwise an in-process memory store (local dev only; not shared across serverless instances).
 */

const STATE_KEY = 'chronos:venue:state'
const REV_KEY = 'chronos:venue:rev'
const CAS = `local r = tonumber(redis.call('GET', KEYS[2]) or '0')
if r ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], tostring(r + 1))
return 1`

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

export const storeKind: 'redis' | 'memory' = url && token ? 'redis' : 'memory'

async function redis<T>(command: (string | number)[]): Promise<T> {
  const res = await fetch(url!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  const body = (await res.json()) as { result?: T; error?: string }
  if (!res.ok || body.error) throw new Error(`Redis error: ${body.error ?? res.status}`)
  return body.result as T
}

const mem = globalThis as unknown as { __chronos?: { rev: number; state: VenueState } }

async function read(): Promise<{ rev: number; state: VenueState } | null> {
  if (storeKind === 'memory') return mem.__chronos ?? null
  const [state, rev] = await redis<[string | null, string | null]>(['MGET', STATE_KEY, REV_KEY])
  return state ? { rev: Number(rev ?? 0), state: JSON.parse(state) as VenueState } : null
}

async function cas(expectedRev: number, state: VenueState): Promise<boolean> {
  if (storeKind === 'memory') {
    if ((mem.__chronos?.rev ?? 0) !== expectedRev) return false
    mem.__chronos = { rev: expectedRev + 1, state }
    return true
  }
  const r = await redis<number>(['EVAL', CAS, 2, STATE_KEY, REV_KEY, expectedRev, JSON.stringify(state)])
  return r === 1
}

export async function loadState(seed: () => VenueState): Promise<{ rev: number; state: VenueState }> {
  const current = await read()
  if (current) return current
  const state = seed()
  await cas(0, state)
  return (await read()) ?? { rev: 1, state }
}

/** Read → pure mutator → compare-and-set, retried if another device wrote first. */
export async function mutateState<T>(
  seed: () => VenueState,
  mutator: (s: VenueState) => Result<{ state: VenueState; value: T }>,
): Promise<Result<{ state: VenueState; value: T }>> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { rev, state } = await loadState(seed)
    const result = mutator(state)
    if (!result.ok) return result
    if (await cas(rev, result.value.state)) return ok(result.value)
  }
  throw new Error('Too many concurrent writes; try again')
}
