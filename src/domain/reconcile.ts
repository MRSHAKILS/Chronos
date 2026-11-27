import { sumCents } from './money'
import type { Exchange, LedgerEntry, VenueState } from './types'

export interface ExchangeReconciliation {
  exchangeId: string
  status: Exchange['status']
  premiumCents: number
  compensationCents: number
  merchantFeeCents: number
  ledgerPremiumCents: number
  ledgerCompensationCents: number
  ledgerFeeCents: number
  paymentRef?: string
  balanced: boolean
  issues: string[]
}

export interface VenueTotals {
  premiumCollectedCents: number
  compensationIssuedCents: number
  merchantFeeRevenueCents: number
  refundedCents: number
  capturedCents: number
  confirmedExchanges: number
  pendingExchanges: number
  failedExchanges: number
}

function entriesFor(ledger: LedgerEntry[], exchangeId: string, kind: LedgerEntry['kind']): number {
  return sumCents(ledger.filter((l) => l.exchangeId === exchangeId && l.kind === kind).map((l) => l.amountCents))
}

/**
 * Checks every exchange against the ledger. For a confirmed exchange:
 *   premium = Σ compensation + merchant fee     (quote)
 *   ledger premium = quote premium, etc.        (ledger mirrors quote)
 * Released exchanges must have no premium; refunded ones must refund in full.
 */
export function reconcileExchanges(state: VenueState): ExchangeReconciliation[] {
  return Object.values(state.exchanges)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((ex) => {
      const q = ex.quote
      const issues: string[] = []
      const ledgerPremiumCents = entriesFor(state.ledger, ex.id, 'priority_premium')
      const ledgerCompensationCents = entriesFor(state.ledger, ex.id, 'customer_compensation')
      const ledgerFeeCents = entriesFor(state.ledger, ex.id, 'merchant_fee')
      const ledgerRefundCents = entriesFor(state.ledger, ex.id, 'priority_refund')
      if (q.totalCents !== q.compensationTotalCents + q.merchantFeeCents) issues.push('Quote premium ≠ compensation + fee')
      if (ex.status === 'confirmed') {
        if (ex.payment.status !== 'paid') issues.push('Confirmed without a paid payment')
        if (ledgerPremiumCents !== q.totalCents) issues.push('Ledger premium differs from quote')
        if (ledgerCompensationCents !== q.compensationTotalCents) issues.push('Ledger compensation differs from quote')
        if (ledgerFeeCents !== q.merchantFeeCents) issues.push('Ledger fee differs from quote')
        if (ledgerPremiumCents !== ledgerCompensationCents + ledgerFeeCents) issues.push('Ledger premium ≠ compensation + fee')
      } else if (ex.status === 'refunded') {
        if (ledgerRefundCents !== q.totalCents) issues.push('Refund does not match the amount paid')
        if (ledgerCompensationCents !== 0) issues.push('Refunded exchange issued compensation')
      } else if (ledgerPremiumCents + ledgerCompensationCents + ledgerFeeCents !== 0) {
        issues.push(`${ex.status} exchange has ledger entries`)
      }
      return {
        exchangeId: ex.id,
        status: ex.status,
        premiumCents: q.totalCents,
        compensationCents: q.compensationTotalCents,
        merchantFeeCents: q.merchantFeeCents,
        ledgerPremiumCents,
        ledgerCompensationCents,
        ledgerFeeCents,
        paymentRef: ex.payment.paymentIntentId ?? ex.payment.sessionId,
        balanced: issues.length === 0,
        issues,
      }
    })
}

export function venueTotals(state: VenueState): VenueTotals {
  const sum = (kind: LedgerEntry['kind']) => sumCents(state.ledger.filter((l) => l.kind === kind).map((l) => l.amountCents))
  const exchanges = Object.values(state.exchanges)
  return {
    premiumCollectedCents: sum('priority_premium'),
    compensationIssuedCents: sum('customer_compensation'),
    merchantFeeRevenueCents: sum('merchant_fee'),
    refundedCents: sum('priority_refund'),
    capturedCents: sum('order_capture'),
    confirmedExchanges: exchanges.filter((e) => e.status === 'confirmed').length,
    pendingExchanges: exchanges.filter((e) => e.status === 'pending').length,
    failedExchanges: exchanges.filter((e) => e.status === 'released' || e.status === 'refunded').length,
  }
}
