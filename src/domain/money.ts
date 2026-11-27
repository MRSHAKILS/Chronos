/**
 * Money is always integer cents. Floating point never touches a price.
 */
export type Cents = number

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of cents, received ${value}`)
  }
  return value
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0
  for (const v of values) total += assertCents(v)
  return assertCents(total, 'sum')
}

/** ceil(amount * bps / 10_000) using integer arithmetic only. */
export function ceilBps(amount: Cents, bps: number): Cents {
  assertCents(amount)
  assertCents(bps, 'basis points')
  return Math.floor((amount * bps + 9_999) / 10_000)
}

export function formatCents(cents: Cents, currency = 'usd'): string {
  assertCents(cents)
  const sign = cents < 0 ? '−' : ''
  const abs = Math.abs(cents)
  const symbol = currency === 'usd' ? '$' : `${currency.toUpperCase()} `
  return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  return r === 0 ? `${m}m` : `${m}m ${String(r).padStart(2, '0')}s`
}
