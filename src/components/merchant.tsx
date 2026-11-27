'use client'

import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, KeyRound, Loader2, LogOut, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { formatCents } from '@/domain/money'
import type { Exchange, VenueState } from '@/domain/types'
import { useMerchant } from '@/lib/use-chronos'
import { Button, Header, Label, LiveQueue, Row, useNow } from './panels'

export function MerchantApp() {
  const m = useMerchant()
  const now = useNow()
  const d = m.data

  if (!d) {
    return (
      <main className="min-h-screen">
        <Header title="Café console" />
        <p className="flex items-center gap-2 p-8 font-mono text-xs uppercase">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      </main>
    )
  }

  if (!d.authenticated || !d.state) return <Login merchant={m} demoPasscode={d.demoPasscode ?? null} />

  const state = d.state
  const serving = state.queue.some((id) => state.parties[id]?.status === 'serving')
  const pending = Object.values(state.exchanges).filter((e) => e.status === 'pending')

  return (
    <main className="min-h-screen">
      <Header title="Café console" mode={d.mode}>
        <Button onClick={m.reset} disabled={m.busy}>
          <RotateCcw size={14} /> Reset demo
        </Button>
        <Button onClick={m.logout}>
          <LogOut size={14} /> Sign out
        </Button>
      </Header>
      {m.message && <p className="border-b border-signal px-8 py-2 font-mono text-xs text-signal">{m.message}</p>}
      <div className="grid lg:grid-cols-[1fr_440px]">
        <div>
          <LiveQueue
            state={state}
            now={now}
            explain={false}
            action={
              <Button tone="solid" onClick={m.serveNext} disabled={m.busy || state.queue.length === 0}>
                {serving ? 'Finish order & charge' : 'Call next customer'} <ArrowUpRight size={14} />
              </Button>
            }
          />
          {pending.length > 0 && (
            <section className="px-5 pb-8 md:px-8">
              <Label>Waiting for payment</Label>
              <div className="mt-3 space-y-2">
                {pending.map((e) => (
                  <div key={e.id} className="glass flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>
                      {name(state, e.quote.requesterId)} · #{e.quote.fromPosition} → #{e.quote.targetPosition} ·{' '}
                      <b className="font-mono">{formatCents(e.quote.totalCents)}</b>
                      <span className="ml-2 font-mono text-xs text-obsidian/55">
                        reserved until {new Date(e.reservationExpiresAt).toLocaleTimeString()}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <Button onClick={() => m.reconcileExchange(e.id)} disabled={m.busy}>
                        Check payment
                      </Button>
                      <Button onClick={() => m.cancelExchange(e.id)} disabled={m.busy}>
                        Cancel
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <MoneyTrail state={state} merchant={m} />
      </div>
    </main>
  )
}

function name(state: VenueState, id: string) {
  return state.parties[id]?.displayName ?? id
}

function Login({ merchant, demoPasscode }: { merchant: ReturnType<typeof useMerchant>; demoPasscode: string | null }) {
  const [passcode, setPasscode] = useState(demoPasscode ?? '')
  return (
    <main className="min-h-screen">
      <Header title="Café console" />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void merchant.login(passcode)
        }}
        className="glass mx-auto mt-16 max-w-sm space-y-4 p-6"
      >
        <p className="flex items-center gap-2 font-display text-2xl">
          <KeyRound className="text-signal" /> Staff sign-in
        </p>
        <p className="text-sm text-obsidian/70">The console can serve customers, capture payments and reset the demo, so it is protected.</p>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          className="w-full border border-obsidian bg-ivory/70 px-3 py-2 outline-none focus:border-signal"
        />
        {demoPasscode && (
          <p className="font-mono text-[11px] text-obsidian/60">
            Public demo passcode: <b>{demoPasscode}</b>
          </p>
        )}
        {merchant.message && <p className="text-xs text-signal">{merchant.message}</p>}
        <Button type="submit" tone="solid" disabled={merchant.busy} className="w-full py-3">
          Sign in
        </Button>
      </form>
    </main>
  )
}

const statusTone: Record<Exchange['status'], string> = {
  confirmed: 'text-emerald',
  pending: 'text-obsidian/60',
  released: 'text-signal',
  refunded: 'text-signal',
}

function MoneyTrail({ state, merchant }: { state: VenueState; merchant: ReturnType<typeof useMerchant> }) {
  const d = merchant.data!
  const exchanges = Object.values(state.exchanges).sort((a, b) => b.createdAt - a.createdAt)
  const served = Object.values(state.parties)
    .filter((p) => p.status === 'served')
    .sort((a, b) => (b.servedAt ?? 0) - (a.servedAt ?? 0))
  const recon = new Map((d.reconciliation ?? []).map((r) => [r.exchangeId, r]))
  const t = d.totals

  return (
    <section className="space-y-8 border-obsidian p-5 md:p-6 lg:border-l">
      <div>
        <Label>Totals</Label>
        <div className="mt-2 space-y-1 font-mono text-xs tabular">
          <Row k="Priority premiums collected" v={formatCents(t?.premiumCollectedCents ?? 0)} />
          <Row k="Paid to waiting customers" v={formatCents(t?.compensationIssuedCents ?? 0)} tone="text-emerald" />
          <Row k="Café exchange fees" v={formatCents(t?.merchantFeeRevenueCents ?? 0)} bold />
          <Row k="Refunded" v={formatCents(t?.refundedCents ?? 0)} />
          <Row k="Orders captured" v={formatCents(t?.capturedCents ?? 0)} />
        </div>
      </div>

      <div>
        <Label>Money trail</Label>
        <p className="mt-1 text-xs text-obsidian/65">Each priority payment splits into discounts for the people passed plus the café fee. Nothing is invented.</p>
        {exchanges.length === 0 && <p className="mt-4 font-mono text-xs text-obsidian/50">No priority purchases yet.</p>}
        <AnimatePresence>
          {exchanges.map((ex) => {
            const q = ex.quote
            const r = recon.get(ex.id)
            return (
              <motion.div key={ex.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass mt-3 font-mono text-xs tabular">
                <div className="flex justify-between border-b border-obsidian/20 px-3 py-2">
                  <span className={`uppercase ${statusTone[ex.status]}`}>
                    {ex.status}
                    {ex.releaseReason && ` · ${ex.releaseReason.replace('_', ' ')}`}
                  </span>
                  <span className="text-obsidian/50">{ex.payment.provider === 'stripe' ? (ex.payment.paymentIntentId ?? ex.payment.sessionId ?? ex.id) : ex.id}</span>
                </div>
                <div className="space-y-1 px-3 py-2">
                  <Row k={`${name(state, q.requesterId)} · #${q.fromPosition}→#${q.targetPosition}`} v={formatCents(q.totalCents)} />
                  {q.affected.map((a) => (
                    <Row key={a.partyId} k={`↳ discount to ${a.displayName} (agreed ≥${formatCents(a.consent.minCompensationCents)})`} v={formatCents(a.compensationCents)} tone="text-emerald" />
                  ))}
                  <Row k="↳ café fee" v={formatCents(q.merchantFeeCents)} />
                  {r && (
                    <p className={`border-t border-dashed border-obsidian/40 pt-1 ${r.balanced ? 'text-emerald' : 'text-signal'}`}>
                      {r.balanced ? '✓ reconciled with ledger' : `⚠ ${r.issues.join('; ')}`}
                    </p>
                  )}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {served.length > 0 && (
        <div>
          <Label>Finished orders</Label>
          <div className="mt-2 space-y-2 font-mono text-xs tabular">
            {served.map((p) => (
              <div key={p.id} className="space-y-0.5">
                <Row k={`${p.displayName} · menu ${formatCents(p.orderTotalCents)}`} v={`final ${formatCents(p.finalChargeCents ?? 0)}`} bold />
                <p className="text-obsidian/55">
                  {p.payment.kind === 'stripe'
                    ? `Stripe ${p.payment.status.replace('_', ' ')}${p.payment.capturedCents !== undefined ? ` · captured ${formatCents(p.payment.capturedCents)} of ${formatCents(p.payment.authorizedCents)}` : ''}`
                    : p.payment.kind === 'simulated'
                      ? `Simulated card · captured ${formatCents(p.payment.capturedCents ?? 0)} of ${formatCents(p.payment.authorizedCents)}`
                      : 'Paid at counter'}
                </p>
                {p.payment.kind === 'stripe' && p.payment.status === 'capture_failed' && (
                  <Button onClick={() => merchant.retryCapture(p.id)} disabled={merchant.busy}>
                    Retry capture
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
