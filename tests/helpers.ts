import { DEMO_PARTIES, demoVenueConfig, menuItem } from '@/domain/demo'
import { createVenueState, joinQueue, type Ids } from '@/domain/queue'
import type { ConsentPolicy, VenueState } from '@/domain/types'

export const T0 = Date.UTC(2026, 10, 27, 9, 0, 0)

export function seqIds(): Ids {
  let n = 0
  return { next: (prefix) => `${prefix}_${++n}` }
}

export function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.value
}

export function join(
  state: VenueState,
  id: string,
  sku: string,
  consent: Omit<ConsentPolicy, 'updatedAt'>,
  now = T0,
): VenueState {
  const item = menuItem(sku)!
  return unwrap(
    joinQueue(
      state,
      {
        partyId: id,
        displayName: id[0]!.toUpperCase() + id.slice(1),
        orderItems: [{ sku: item.sku, name: item.name, cents: item.cents }],
        serviceSec: item.serviceSec,
        consent,
        payment: { kind: 'simulated', status: 'authorized', authorizedCents: item.cents },
        tokenHash: null,
      },
      now,
    ),
  ).state
}

/** Alice, Bob, Charlie (consenting) and Daniel (wants priority). */
export function demoState(): VenueState {
  let s = createVenueState(demoVenueConfig(), T0)
  for (const p of DEMO_PARTIES) s = join(s, p.displayName.toLowerCase(), p.sku, p.consent)
  s = join(s, 'daniel', 'cold-brew', { optIn: false, minCompensationCents: 50, maxAdditionalDelaySec: 0 })
  return s
}
