'use client'

import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { ArrowUpRight, Check, Clock, HelpCircle, Info, RotateCcw, ShieldCheck, UserPlus, Zap } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { estimateWaits } from '@/domain/queue'
import { formatCents, formatDuration } from '@/domain/money'
import { quoteLadder } from '@/domain/quote'
import { venueTotals } from '@/domain/reconcile'
import type { Exchange, Quote, VenueState } from '@/domain/types'
import type { useChronos } from '@/lib/use-chronos'

const spring = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } as const
type Chronos = ReturnType<typeof useChronos>

export function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function latestExchange(state: VenueState): Exchange | undefined {
  return Object.values(state.exchanges)
    .filter((e) => e.status === 'confirmed')
    .sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0))[0]
}

/* ─────────────────────────── Header ─────────────────────────── */

export function Header({ title, store, onReset }: { title: string; store?: Chronos['store']; onReset?: () => void }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-obsidian px-6 pt-5 pb-4 md:px-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase">CHRONOS Coffee Lab · {title}</p>
        <Link href="/" className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
          CHRONOS<span className="text-signal">.</span>
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {store && (
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase">
            <span className={`h-2 w-2 rounded-full ${store === 'redis' ? 'animate-pulse bg-emerald' : 'bg-obsidian/40'}`} />
            {store === 'redis' ? 'Live sync · all devices' : 'Local server only'}
          </span>
        )}
        <span className="border border-signal px-2 py-1 font-mono text-[11px] text-signal uppercase">Simulated payments · no real money</span>
        <Link href="/#how" className="flex items-center gap-1 font-mono text-[11px] uppercase hover:text-signal">
          <HelpCircle size={13} /> How it works
        </Link>
        {onReset && (
          <button
            onClick={onReset}
            className="flex items-center gap-2 border border-obsidian px-3 py-1.5 font-mono text-xs uppercase hover:bg-obsidian hover:text-ivory"
          >
            <RotateCcw size={14} /> Reset demo
          </button>
        )}
      </div>
    </header>
  )
}

/* ─────────────────────────── Customer (phone) ─────────────────────────── */

const STEPS = ['Join', 'Choose a spot', 'Pay', 'Done']

function Stepper({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-4 gap-1">
      {STEPS.map((s, i) => (
        <li key={s} className="space-y-1">
          <div className={`h-1 ${i <= step ? 'bg-signal' : 'bg-obsidian/15'} transition-colors`} />
          <p className={`font-mono text-[10px] uppercase ${i === step ? 'text-obsidian' : 'text-obsidian/45'}`}>{s}</p>
        </li>
      ))}
    </ol>
  )
}

export function CustomerPanel({ chronos, now }: { chronos: Chronos; now: number }) {
  const { state, actions, message, busy } = chronos
  const [quote, setQuote] = useState<Quote | null>(null)
  if (!state) return null
  const daniel = state.parties.daniel
  const inQueue = Boolean(daniel && state.queue.includes('daniel'))
  const position = state.queue.indexOf('daniel') + 1
  const waits = estimateWaits(state, now)
  const ladder = inQueue ? quoteLadder(state, 'daniel', now) : []
  const mine = Object.values(state.exchanges).find((e) => e.status === 'confirmed' && e.quote.requesterId === 'daniel')
  const step = !daniel ? 0 : mine || !inQueue ? 3 : quote ? 2 : 1

  return (
    <section className="space-y-6 p-5">
      <Stepper step={step} />

      <div className="glass p-5">
        {!daniel && (
          <div className="space-y-4">
            <p className="font-mono text-[11px] uppercase text-obsidian/60">You are Daniel, and you’re in a hurry</p>
            <p className="font-display text-2xl leading-tight">Three people are already waiting for coffee.</p>
            <p className="text-sm text-obsidian/70">
              Join the queue, then you can <b>pay the people ahead of you to let you go first</b>. They agreed to this in advance and
              set their own price.
            </p>
            <div className="flex justify-between border-y border-obsidian/15 py-2 font-mono text-sm">
              <span>Nitro Cold Brew</span>
              <span>{formatCents(800)}</span>
            </div>
            <button
              onClick={actions.joinDaniel}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 bg-obsidian py-3 font-mono text-sm text-ivory uppercase disabled:opacity-50"
            >
              <UserPlus size={16} /> Join the queue
            </button>
          </div>
        )}

        {inQueue && (
          <div className="space-y-5">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase">Your place in line</p>
                <motion.p key={position} initial={{ scale: 1.3, color: '#FF5722' }} animate={{ scale: 1, color: '#141414' }} className="font-display text-6xl font-semibold tabular">
                  #{position}
                </motion.p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[11px] uppercase">Wait before your turn</p>
                <p className="font-mono text-2xl tabular">{formatDuration(waits.daniel ?? 0)}</p>
              </div>
            </div>

            {quote ? (
              <Receipt
                quote={quote}
                busy={busy}
                onPay={() => {
                  actions.pay(quote)
                  setQuote(null)
                }}
                onCancel={() => setQuote(null)}
              />
            ) : ladder.length > 0 ? (
              <div>
                <p className="font-display text-lg leading-tight">Want to go sooner?</p>
                <p className="mb-3 text-xs text-obsidian/65">Pick a spot. You pay each person you pass the price they set, plus a small café fee.</p>
                <div className="divide-y divide-obsidian/15 border border-obsidian bg-ivory/60">
                  {ladder.map((step) => (
                    <button
                      key={step.targetPosition}
                      disabled={!step.available || busy}
                      onClick={() => actions.quote('daniel', step.targetPosition).then(setQuote)}
                      className="group flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-signal/10 disabled:opacity-40"
                    >
                      <span>
                        <span className="font-mono text-sm font-semibold">Move to #{step.targetPosition}</span>
                        <span className="block text-[11px] text-obsidian/60">
                          pass {position - step.targetPosition} {position - step.targetPosition === 1 ? 'person' : 'people'}
                          {step.available && ` · save ${formatDuration(step.quote.timeSavedSec)}`}
                        </span>
                      </span>
                      {step.available ? (
                        <span className="flex items-center gap-2 font-mono text-sm font-semibold tabular">
                          {formatCents(step.quote.totalCents)} <ArrowUpRight size={14} className="opacity-40 group-hover:opacity-100" />
                        </span>
                      ) : (
                        <span className="max-w-[150px] text-right text-[11px]">{step.reason.message}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <SuccessNote state={state} />
            )}
            {message && <p className="border-l-2 border-signal pl-2 text-xs text-signal">{message}</p>}
          </div>
        )}

        {daniel && !inQueue && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-display text-xl">
              <Check className="text-emerald" /> Served
            </p>
            <p className="font-mono text-sm">Final charge {formatCents(daniel.finalChargeCents ?? 0)}</p>
          </div>
        )}
      </div>

      <div>
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-obsidian/70">What the people ahead agreed to</p>
        <ul className="mt-3 space-y-2">
          {state.queue
            .map((id) => state.parties[id]!)
            .filter((p) => p.id !== 'daniel')
            .map((p) => (
              <li key={p.id} className="flex items-center justify-between text-xs">
                <span className="font-medium">{p.displayName}</span>
                <span className="font-mono text-obsidian/65">
                  {p.consent.optIn
                    ? `lets you pass for ${formatCents(p.consent.minCompensationCents)} · up to ${formatDuration(p.consent.maxAdditionalDelaySec)} extra`
                    : 'does not want to be passed'}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </section>
  )
}

function SuccessNote({ state }: { state: VenueState }) {
  const ex = Object.values(state.exchanges).find((e) => e.status === 'confirmed' && e.quote.requesterId === 'daniel')
  if (!ex) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald">
        <ShieldCheck size={16} /> You’re at the front.
      </p>
    )
  }
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 border border-emerald/40 bg-emerald/5 p-3">
      <p className="flex items-center gap-2 font-display text-lg text-emerald">
        <Check size={18} /> You moved from #{ex.quote.fromPosition} to #{ex.quote.targetPosition}
      </p>
      <p className="text-xs text-obsidian/75">
        You paid {formatCents(ex.quote.totalCents)} and saved {formatDuration(ex.quote.timeSavedSec)}.{' '}
        {ex.quote.affected.map((a) => `${a.displayName} got ${formatCents(a.compensationCents)} off`).join(', ')}.
      </p>
    </motion.div>
  )
}

export function Receipt({ quote, busy, onPay, onCancel }: { quote: Quote; busy: boolean; onPay: () => void; onCancel: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="border border-obsidian bg-ivory">
      <div className="flex justify-between bg-obsidian px-3 py-2 font-mono text-[11px] text-ivory uppercase">
        <span>Your price</span>
        <span>
          #{quote.fromPosition} → #{quote.targetPosition}
        </span>
      </div>
      <div className="space-y-1.5 px-3 py-3 font-mono text-sm tabular">
        <p className="pb-1 font-sans text-[11px] text-obsidian/60">Each person you pass waits a little longer and gets this off their order:</p>
        {quote.affected.map((a) => (
          <div key={a.partyId} className="flex justify-between">
            <span>
              {a.displayName} <span className="text-obsidian/50">waits +{formatDuration(a.additionalDelaySec)}</span>
            </span>
            <span className="text-emerald">{formatCents(a.compensationCents)}</span>
          </div>
        ))}
        <div className="flex justify-between text-obsidian/60">
          <span>Café fee</span>
          <span>{formatCents(quote.merchantFeeCents)}</span>
        </div>
        <div className="flex justify-between border-t border-dashed border-obsidian pt-2 font-semibold">
          <span>You pay</span>
          <span>{formatCents(quote.totalCents)}</span>
        </div>
        <p className="flex items-center gap-1 pt-1 text-xs text-emerald">
          <Clock size={12} /> You save {formatDuration(quote.timeSavedSec)}
        </p>
      </div>
      <div className="grid grid-cols-[1fr_auto]">
        <button onClick={onPay} disabled={busy} className="flex items-center justify-center gap-2 bg-signal py-3 font-mono text-sm text-white uppercase disabled:opacity-60">
          <Zap size={16} /> Pay {formatCents(quote.totalCents)}
        </button>
        <button onClick={onCancel} className="border-l border-obsidian px-4 font-mono text-xs uppercase">
          Back
        </button>
      </div>
      <p className="border-t border-obsidian/15 px-3 py-2 text-[10px] text-obsidian/55">Demo payment, no card is charged. Price locked for 60 seconds.</p>
    </motion.div>
  )
}

/* ─────────────────────────── Live queue display ─────────────────────────── */

function ExchangeBanner({ state }: { state: VenueState }) {
  const ex = latestExchange(state)
  const name = ex ? state.parties[ex.quote.requesterId]?.displayName : undefined
  return (
    <AnimatePresence mode="wait">
      {ex && (
        <motion.div
          key={ex.id}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-l-4 border-signal bg-signal/8 px-4 py-3"
        >
          <span className="font-mono text-[11px] tracking-[0.18em] text-signal uppercase">Just now</span>
          <span className="font-display text-lg">
            {name} paid {formatCents(ex.quote.totalCents)} to move #{ex.quote.fromPosition} → #{ex.quote.targetPosition}
          </span>
          <span className="font-mono text-xs text-obsidian/65">
            {ex.quote.affected.map((a) => `${a.displayName} +${formatCents(a.compensationCents)}`).join(' · ')} · café {formatCents(ex.quote.merchantFeeCents)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function LiveQueue({ state, onServe, now, explain = true }: { state: VenueState; onServe?: () => void; now: number; explain?: boolean }) {
  const waits = estimateWaits(state, now)
  const totals = venueTotals(state)
  const serving = state.queue.some((id) => state.parties[id]?.status === 'serving')

  return (
    <section className="p-6 md:p-8">
      {explain && (
        <p className="mb-5 flex max-w-3xl items-start gap-2 text-sm text-obsidian/70">
          <Info size={16} className="mt-0.5 shrink-0" />
          Customers can buy a faster spot. Everyone they pass agreed beforehand, set their own price, and gets that money off their order.
        </p>
      )}
      <div className="glass mb-6 grid grid-cols-1 sm:grid-cols-3">
        <Stat label="Paid to waiting customers" value={formatCents(totals.compensationIssuedCents)} accent="text-emerald" />
        <Stat label="Café earned from priority" value={formatCents(totals.merchantFeeRevenueCents)} />
        <Stat label="Priority purchases" value={String(totals.confirmedExchanges)} />
      </div>

      <ExchangeBanner state={state} />

      <div className="mb-3 flex items-center justify-between">
        <Label>Queue now</Label>
        {onServe && (
          <button
            onClick={onServe}
            className="flex items-center gap-1 border border-obsidian px-3 py-1.5 font-mono text-xs uppercase hover:bg-obsidian hover:text-ivory"
          >
            {serving ? 'Finish order & charge' : 'Call next customer'} <ArrowUpRight size={14} />
          </button>
        )}
      </div>

      <LayoutGroup>
        <ol className="border-t border-obsidian">
          <AnimatePresence initial={false}>
            {state.queue.map((id, i) => {
              const p = state.parties[id]!
              const isBuyer = Boolean(latestExchange(state)?.quote.requesterId === id)
              return (
                <motion.li
                  key={id}
                  layout
                  transition={spring}
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  className={`grid grid-cols-[64px_1fr_auto] items-center gap-4 border-b border-obsidian py-5 md:grid-cols-[90px_1fr_auto_auto] md:gap-6 ${
                    isBuyer ? 'bg-signal/8' : ''
                  }`}
                >
                  <motion.span layout="position" className="font-display text-5xl font-semibold tabular md:text-6xl">
                    {String(i + 1).padStart(2, '0')}
                  </motion.span>
                  <div>
                    <p className="font-display text-2xl font-medium md:text-3xl">
                      {p.displayName}
                      {p.status === 'serving' && <span className="ml-3 align-middle font-mono text-xs text-emerald uppercase">● ordering now</span>}
                      {isBuyer && p.status !== 'serving' && <span className="ml-3 align-middle font-mono text-xs text-signal uppercase">bought priority</span>}
                    </p>
                    <p className="font-mono text-xs text-obsidian/60">
                      {p.orderItems.map((o) => o.name).join(', ')}
                      {p.consent.optIn && p.status === 'waiting' && ` · lets others pass for ${formatCents(p.consent.minCompensationCents)}`}
                    </p>
                  </div>
                  <div className="hidden text-right font-mono text-sm tabular md:block">
                    {p.earnedDiscountCents > 0 && (
                      <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="text-emerald">
                        +{formatCents(p.earnedDiscountCents)} off
                      </motion.p>
                    )}
                    {p.addedDelaySec > 0 && <p className="text-obsidian/50">+{formatDuration(p.addedDelaySec)} wait</p>}
                  </div>
                  <div className="w-20 text-right md:w-24">
                    <p className="font-mono text-[10px] uppercase text-obsidian/50">Wait</p>
                    <p className="font-mono text-xl tabular">{formatDuration(waits[id] ?? 0)}</p>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
      </LayoutGroup>
      {state.queue.length === 0 && <p className="py-10 font-mono text-sm text-obsidian/50">Nobody is waiting. Reset the demo to start again.</p>}
    </section>
  )
}

/* ─────────────────────────── Merchant ledger ─────────────────────────── */

export function Ledger({ state }: { state: VenueState }) {
  const exchanges = Object.values(state.exchanges).sort((a, b) => b.createdAt - a.createdAt)
  const served = Object.values(state.parties).filter((p) => p.status === 'served')

  return (
    <section className="border-obsidian p-6 lg:border-l">
      <Label>Money trail</Label>
      <p className="mt-1 text-xs text-obsidian/65">Every cent a buyer pays goes to the people they passed, except the café fee. Nothing is invented.</p>
      {exchanges.length === 0 && <p className="mt-4 font-mono text-xs text-obsidian/50">No priority purchases yet.</p>}
      <AnimatePresence>
        {exchanges.map((ex) => {
          const q = ex.quote
          const name = state.parties[q.requesterId]?.displayName
          return (
            <motion.div key={ex.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass mt-4 font-mono text-xs tabular">
              <div className="flex justify-between border-b border-obsidian/20 px-3 py-2">
                <span className="uppercase">{ex.status === 'confirmed' ? 'Paid' : ex.status}</span>
                <span className="text-obsidian/50">{ex.id}</span>
              </div>
              <div className="space-y-1 px-3 py-2">
                <Row k={`${name} paid · #${q.fromPosition}→#${q.targetPosition}`} v={`+${formatCents(q.totalCents)}`} />
                {q.affected.map((a) => (
                  <Row key={a.partyId} k={`Discount to ${a.displayName}`} v={`−${formatCents(a.compensationCents)}`} tone="text-emerald" />
                ))}
                <div className="border-t border-dashed border-obsidian pt-1">
                  <Row k="Café keeps" v={formatCents(q.merchantFeeCents)} bold />
                </div>
                <p className={`pt-1 ${q.totalCents === q.compensationTotalCents + q.merchantFeeCents ? 'text-emerald' : 'text-signal'}`}>
                  ✓ paid = discounts + café fee
                </p>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>

      {served.length > 0 && (
        <div className="mt-8">
          <Label>Finished orders</Label>
          <div className="mt-2 space-y-1 font-mono text-xs tabular">
            {served.map((p) => (
              <Row key={p.id} k={`${p.displayName} · menu price ${formatCents(p.orderTotalCents)}`} v={`charged ${formatCents(p.finalChargeCents ?? 0)}`} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/* ─────────────────────────── Primitives ─────────────────────────── */

export function Label({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-obsidian/70">{children}</p>
}

export function Stat({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border-b border-obsidian/15 px-5 py-4 last:border-0 sm:border-r sm:border-b-0">
      <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-obsidian/60">{label}</p>
      <p className={`font-display text-4xl font-semibold tabular ${accent}`}>{value}</p>
    </div>
  )
}

export function Row({ k, v, tone = '', bold = false }: { k: string; v: string; tone?: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'font-semibold' : ''}`}>
      <span>{k}</span>
      <span className={tone}>{v}</span>
    </div>
  )
}
