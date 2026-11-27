import type { ConsentPolicy, OrderItem, VenueConfig } from './types'

/** Demo café configuration. The engine itself knows nothing about coffee. */
export const DEMO_VENUE_ID = 'chronos-coffee-lab'

export function demoVenueConfig(): VenueConfig {
  return {
    id: DEMO_VENUE_ID,
    name: 'CHRONOS Coffee Lab',
    currency: 'usd',
    merchantFeeCents: 25,
    quoteTtlSec: 60,
    reservationTtlSec: 15 * 60,
    minChargeFloorCents: 50,
    minChargeRatioBps: 5_000,
    paymentMinimumCents: 50,
  }
}

export interface MenuItem extends OrderItem {
  serviceSec: number
  note: string
}

export const MENU: MenuItem[] = [
  { sku: 'flat-white', name: 'Flat White', cents: 1000, serviceSec: 180, note: 'Double ristretto, steamed milk' },
  { sku: 'pour-over', name: 'Single-Origin Pour Over', cents: 1200, serviceSec: 240, note: 'Ethiopia Guji, 3 min bloom' },
  { sku: 'espresso', name: 'Espresso', cents: 600, serviceSec: 120, note: '18g in, 36g out' },
  { sku: 'cold-brew', name: 'Nitro Cold Brew', cents: 800, serviceSec: 150, note: '18-hour steep' },
  { sku: 'cortado', name: 'Cortado', cents: 750, serviceSec: 150, note: 'Equal parts espresso and milk' },
]

export function menuItem(sku: string): MenuItem | undefined {
  return MENU.find((m) => m.sku === sku)
}

export interface DemoParty {
  displayName: string
  sku: string
  consent: Omit<ConsentPolicy, 'updatedAt'>
}

/** Alice, Bob and Charlie: three consenting customers already waiting. */
export const DEMO_PARTIES: DemoParty[] = [
  { displayName: 'Alice', sku: 'flat-white', consent: { optIn: true, minCompensationCents: 50, maxAdditionalDelaySec: 900 } },
  { displayName: 'Bob', sku: 'pour-over', consent: { optIn: true, minCompensationCents: 75, maxAdditionalDelaySec: 900 } },
  { displayName: 'Charlie', sku: 'espresso', consent: { optIn: true, minCompensationCents: 25, maxAdditionalDelaySec: 600 } },
]
