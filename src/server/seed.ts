import { DEMO_PARTIES, demoVenueConfig, menuItem } from '@/domain/demo'
import { createVenueState, joinQueue } from '@/domain/queue'
import type { VenueState } from '@/domain/types'

/** The demo venue: Alice, Bob and Charlie waiting, each opted in with their own price and delay limit. */
export function seedState(now: number): VenueState {
  let s = createVenueState(demoVenueConfig(), now)
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
      now,
    )
    if (r.ok) s = r.value.state
  }
  return s
}
