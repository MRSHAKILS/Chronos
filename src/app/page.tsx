'use client'

import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { ArrowUpRight, Clock, RotateCcw, ShieldCheck, UserPlus, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { estimateWaits } from '@/domain/queue'
import { formatCents, formatDuration } from '@/domain/money'
import { quoteLadder } from '@/domain/quote'
import { venueTotals } from '@/domain/reconcile'
import type { Quote, VenueState } from '@/domain/types'
import { useChronos } from '@/lib/use-chronos'

const spring = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } as const

export default function Home() {
  const { state, message, actions } = useChronos()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!state) return <div className="min-h-screen" />

  return (
    <main className="min-h-screen">
      <header className="flex items-end justify-between border-b border-obsidian px-8 pt-6 pb-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase">{state.config.name} · Live exchange</p>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            CHRONOS<span className="text-signal">.</span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <p className="font-display text-lg">Time is currency.</p>
          <span className="border border-signal px-2 py-1 font-mono text-[11px] text-signal uppercase">
            Simulation · no real money
          </span>
          <button
            onClick={actions.reset}
            className="flex items-center gap-2 border border-obsidian px-3 py-1.5 font-mono text-xs uppercase hover:bg-obsidian hover:text-ivory"
          >
            <RotateCcw size={14} /> Reset demo
          </button>
        </div>
      </header>

      <div className="grid grid-cols-[360px_1fr_380px]">
        <CustomerPanel state={state} actions={actions} message={message} now={now} />
        <LiveQueue state={state} onServe={actions.serveNext} now={now} />
        <Ledger state={state} />
      </div>
    </main>
  )
}

/* ─────────────────────────── Customer (phone) ─────────────────────────── */

function CustomerPanel({
  state,
  actions,
  message,
  now,
}: {
  now: number
  state: VenueState
  actions: ReturnType<typeof useChronos>['actions']
  message: string | null
}) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const daniel = state.parties.daniel
  const inQueue = daniel && state.queue.includes('daniel')
  const position = state.queue.indexOf('daniel') + 1
  const waits = estimateWaits(state, now)
  const ladder = inQueue ? quoteLadder(state, 'daniel', now) : []

  return (
    <section className="border-r border-obsidian p-6">
      <Label>Customer · Daniel’s phone</Label>
      <div className="mt-4 border border-obsidian bg-white/60 p-5">
        {!daniel && (
          <div className="space-y-4">
            <p className="font-display text-2xl leading-tight">Join the queue at CHRONOS Coffee Lab</p>
            <p className="text-sm text-obsidian/70">Nitro Cold Brew · {formatCents(800)}</p>
            <button
              onClick={actions.joinDaniel}
              className="flex w-full items-center justify-center gap-2 bg-obsidian py-3 font-mono text-sm text-ivory uppercase"
            >
              <UserPlus size={16} /> Join as Daniel
            </button>
          </div>
        )}

        {inQueue && (
          <div className="space-y-5">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase">Position</p>
                <p className="font-display text-6xl font-semibold tabular">#{position}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[11px] uppercase">Est. wait</p>
                <p className="font-mono text-2xl tabular">{formatDuration(waits.daniel ?? 0)}</p>
              </div>
            </div>

            {quote ? (
              <Receipt
                quote={quote}
                onPay={() => {
                  actions.pay(quote)
                  setQuote(null)
                }}
                onCancel={() => setQuote(null)}
              />
            ) : ladder.length > 0 ? (
              <div>
                <p className="mb-2 font-mono text-[11px] uppercase">Buy priority</p>
                <div className="divide-y divide-obsidian/15 border border-obsidian">
                  {ladder.map((step) => (
                    <button
                      key={step.targetPosition}
                      disabled={!step.available}
                      onClick={() => setQuote(actions.quote('daniel', step.targetPosition))}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-signal/10 disabled:opacity-40"
                    >
                      <span className="font-mono text-sm">→ #{step.targetPosition}</span>
                      {step.available ? (
                        <span className="flex items-center gap-3 font-mono text-sm tabular">
                          <span className="text-obsidian/60">−{formatDuration(step.quote.timeSavedSec)}</span>
                          <span className="font-semibold">{formatCents(step.quote.totalCents)}</span>
                        </span>
                      ) : (
                        <span className="text-xs">{step.reason.message}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-emerald">
                <ShieldCheck size={16} /> You’re at the front.
              </p>
            )}
            {message && <p className="border-l-2 border-signal pl-2 text-xs text-signal">{message}</p>}
          </div>
        )}

        {daniel && !inQueue && <p className="font-display text-xl">Order served · {formatCents(daniel.finalChargeCents ?? 0)}</p>}
      </div>

      <div className="mt-8">
        <Label>Consent policies</Label>
        <ul className="mt-3 space-y-2">
          {state.queue
            .map((id) => state.parties[id]!)
            .filter((p) => p.id !== 'daniel')
            .map((p) => (
              <li key={p.id} className="flex justify-between font-mono text-xs">
                <span>{p.displayName}</span>
                <span className="text-obsidian/60">
                  {p.consent.optIn ? `≥ ${formatCents(p.consent.minCompensationCents)} · ≤ ${formatDuration(p.consent.maxAdditionalDelaySec)}` : 'opted out'}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </section>
  )
}

function Receipt({ quote, onPay, onCancel }: { quote: Quote; onPay: () => void; onCancel: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="border border-obsidian">
      <div className="flex justify-between bg-obsidian px-3 py-2 font-mono text-[11px] text-ivory uppercase">
        <span>Priority quote</span>
        <span>
          #{quote.fromPosition} → #{quote.targetPosition}
        </span>
      </div>
      <div className="space-y-1.5 px-3 py-3 font-mono text-sm tabular">
        {quote.affected.map((a) => (
          <div key={a.partyId} className="flex justify-between">
            <span>
              {a.displayName} <span className="text-obsidian/50">+{formatDuration(a.additionalDelaySec)}</span>
            </span>
            <span>{formatCents(a.compensationCents)}</span>
          </div>
        ))}
        <div className="flex justify-between text-obsidian/60">
          <span>Merchant fee</span>
          <span>{formatCents(quote.merchantFeeCents)}</span>
        </div>
        <div className="flex justify-between border-t border-dashed border-obsidian pt-2 font-semibold">
          <span>Total</span>
          <span>{formatCents(quote.totalCents)}</span>
        </div>
        <p className="flex items-center gap-1 pt-1 text-xs text-emerald">
          <Clock size={12} /> You save {formatDuration(quote.timeSavedSec)}
        </p>
      </div>
      <div className="grid grid-cols-[1fr_auto]">
        <button onClick={onPay} className="flex items-center justify-center gap-2 bg-signal py-3 font-mono text-sm text-white uppercase">
          <Zap size={16} /> Pay {formatCents(quote.totalCents)}
        </button>
        <button onClick={onCancel} className="border-l border-obsidian px-4 font-mono text-xs uppercase">
          Cancel
        </button>
      </div>
    </motion.div>
  )
}

/* ─────────────────────────── Live queue display ─────────────────────────── */

function LiveQueue({ state, onServe, now }: { state: VenueState; onServe: () => void; now: number }) {
  const waits = estimateWaits(state, now)
  const totals = venueTotals(state)
  const serving = state.queue.some((id) => state.parties[id]?.status === 'serving')

  return (
    <section className="p-8">
      <div className="mb-6 grid grid-cols-3 border border-obsidian">
        <Stat label="Customer compensation" value={formatCents(totals.compensationIssuedCents)} accent="text-emerald" />
        <Stat label="Merchant premium revenue" value={formatCents(totals.merchantFeeRevenueCents)} />
        <Stat label="Exchanges confirmed" value={String(totals.confirmedExchanges)} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <Label>Live queue · v{state.queueVersion}</Label>
        <button onClick={onServe} className="flex items-center gap-1 font-mono text-xs uppercase underline-offset-4 hover:underline">
          {serving ? 'Complete & capture' : 'Serve next'} <ArrowUpRight size={14} />
        </button>
      </div>

      <LayoutGroup>
        <ol className="border-t border-obsidian">
          <AnimatePresence initial={false}>
            {state.queue.map((id, i) => {
              const p = state.parties[id]!
              const isBuyer = id === 'daniel'
              return (
                <motion.li
                  key={id}
                  layout
                  transition={spring}
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  className={`grid grid-cols-[90px_1fr_auto_auto] items-center gap-6 border-b border-obsidian py-5 ${
                    isBuyer ? 'bg-signal/8' : ''
                  }`}
                >
                  <motion.span layout="position" className="font-display text-6xl font-semibold tabular">
                    {String(i + 1).padStart(2, '0')}
                  </motion.span>
                  <div>
                    <p className="font-display text-3xl font-medium">
                      {p.displayName}
                      {p.status === 'serving' && (
                        <span className="ml-3 align-middle font-mono text-xs text-emerald uppercase">● at counter</span>
                      )}
                      {isBuyer && p.status !== 'serving' && (
                        <span className="ml-3 align-middle font-mono text-xs text-signal uppercase">priority</span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-obsidian/60">{p.orderItems.map((o) => o.name).join(', ')}</p>
                  </div>
                  <div className="text-right font-mono text-sm tabular">
                    {p.earnedDiscountCents > 0 && (
                      <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="text-emerald">
                        +{formatCents(p.earnedDiscountCents)} earned
                      </motion.p>
                    )}
                    {p.addedDelaySec > 0 && <p className="text-obsidian/50">+{formatDuration(p.addedDelaySec)} wait</p>}
                  </div>
                  <div className="w-24 text-right">
                    <p className="font-mono text-[10px] uppercase text-obsidian/50">ETA</p>
                    <p className="font-mono text-xl tabular">{formatDuration(waits[id] ?? 0)}</p>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
      </LayoutGroup>
      {state.queue.length === 0 && <p className="py-10 font-mono text-sm text-obsidian/50">Queue empty.</p>}
    </section>
  )
}

/* ─────────────────────────── Merchant ledger ─────────────────────────── */

function Ledger({ state }: { state: VenueState }) {
  const exchanges = Object.values(state.exchanges).sort((a, b) => b.createdAt - a.createdAt)
  const served = Object.values(state.parties).filter((p) => p.status === 'served')

  return (
    <section className="border-l border-obsidian p-6">
      <Label>Merchant ledger</Label>
      {exchanges.length === 0 && <p className="mt-3 font-mono text-xs text-obsidian/50">No exchanges yet.</p>}
      <AnimatePresence>
        {exchanges.map((ex) => {
          const q = ex.quote
          const name = state.parties[q.requesterId]?.displayName
          return (
            <motion.div
              key={ex.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 border border-obsidian font-mono text-xs tabular"
            >
              <div className="flex justify-between border-b border-obsidian px-3 py-2">
                <span className="uppercase">{ex.status}</span>
                <span className="text-obsidian/50">{ex.id}</span>
              </div>
              <div className="space-y-1 px-3 py-2">
                <Row k={`Premium · ${name} #${q.fromPosition}→#${q.targetPosition}`} v={`+${formatCents(q.totalCents)}`} />
                {q.affected.map((a) => (
                  <Row key={a.partyId} k={`Compensation · ${a.displayName}`} v={`−${formatCents(a.compensationCents)}`} tone="text-emerald" />
                ))}
                <div className="border-t border-dashed border-obsidian pt-1">
                  <Row k="Merchant fee (net)" v={formatCents(q.merchantFeeCents)} bold />
                </div>
                <p className={`pt-1 ${q.totalCents === q.compensationTotalCents + q.merchantFeeCents ? 'text-emerald' : 'text-signal'}`}>
                  ✓ premium = compensation + fee
                </p>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>

      {served.length > 0 && (
        <div className="mt-8">
          <Label>Captured orders</Label>
          <div className="mt-2 space-y-1 font-mono text-xs tabular">
            {served.map((p) => (
              <Row
                key={p.id}
                k={`${p.displayName} · auth ${formatCents(p.orderTotalCents)}`}
                v={`captured ${formatCents(p.finalChargeCents ?? 0)}`}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/* ─────────────────────────── Primitives ─────────────────────────── */

function Label({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-obsidian/70">{children}</p>
}

function Stat({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border-r border-obsidian px-5 py-4 last:border-r-0">
      <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-obsidian/60">{label}</p>
      <p className={`font-display text-4xl font-semibold tabular ${accent}`}>{value}</p>
    </div>
  )
}

function Row({ k, v, tone = '', bold = false }: { k: string; v: string; tone?: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'font-semibold' : ''}`}>
      <span>{k}</span>
      <span className={tone}>{v}</span>
    </div>
  )
}
