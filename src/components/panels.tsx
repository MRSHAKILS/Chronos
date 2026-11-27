'use client'

import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { ArrowUpRight, HelpCircle, Info, Lock } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { estimateWaits } from '@/domain/queue'
import { formatCents, formatDuration } from '@/domain/money'
import { venueTotals } from '@/domain/reconcile'
import type { Exchange, VenueState } from '@/domain/types'
import type { Mode } from '@/lib/use-chronos'

export const spring = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } as const

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

export function ModeBadges({ mode }: { mode?: Mode | null }) {
  if (!mode) return null
  return (
    <>
      <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase">
        <span className={`h-2 w-2 rounded-full ${mode.store === 'redis' ? 'animate-pulse bg-emerald' : 'bg-obsidian/40'}`} />
        {mode.store === 'redis' ? 'Live sync · all devices' : 'Local server only'}
      </span>
      <span className="border border-signal px-2 py-1 font-mono text-[11px] text-signal uppercase">
        {mode.payments === 'stripe_sandbox' ? 'Stripe sandbox · test cards only' : 'Simulated payments · no real money'}
      </span>
    </>
  )
}

export function Header({ title, mode, children }: { title: string; mode?: Mode | null; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-obsidian px-5 pt-5 pb-4 md:px-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase">CHRONOS Coffee Lab · {title}</p>
        <Link href="/" className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
          CHRONOS<span className="text-signal">.</span>
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ModeBadges mode={mode} />
        <Link href="/#how" className="flex items-center gap-1 font-mono text-[11px] uppercase hover:text-signal">
          <HelpCircle size={13} /> How it works
        </Link>
        {children}
      </div>
    </header>
  )
}

/* ─────────────────────────── Live queue ─────────────────────────── */

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
          <span className="font-mono text-[11px] tracking-[0.18em] text-signal uppercase">Latest</span>
          <span className="font-display text-lg">
            {name} paid {formatCents(ex.quote.totalCents)} to move #{ex.quote.fromPosition} → #{ex.quote.targetPosition}
          </span>
          <span className="font-mono text-xs text-obsidian/65">
            {ex.quote.affected.map((a) => `${a.displayName} +${formatCents(a.compensationCents)}`).join(' · ')} · café{' '}
            {formatCents(ex.quote.merchantFeeCents)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function LiveQueue({
  state,
  now,
  highlight,
  explain = true,
  action,
}: {
  state: VenueState
  now: number
  highlight?: string | null
  explain?: boolean
  action?: React.ReactNode
}) {
  const waits = estimateWaits(state, now)
  const totals = venueTotals(state)
  const buyer = latestExchange(state)?.quote.requesterId

  return (
    <section className="p-5 md:p-8">
      {explain && (
        <p className="mb-5 flex max-w-3xl items-start gap-2 text-sm text-obsidian/70">
          <Info size={16} className="mt-0.5 shrink-0" />
          Customers can buy a faster spot. Everyone they pass agreed beforehand, set their own price, and gets that money off their
          order.
        </p>
      )}
      <div className="glass mb-6 grid grid-cols-1 sm:grid-cols-3">
        <Stat label="Paid to waiting customers" value={formatCents(totals.compensationIssuedCents)} accent="text-emerald" />
        <Stat label="Café earned from priority" value={formatCents(totals.merchantFeeRevenueCents)} />
        <Stat label="Priority purchases" value={String(totals.confirmedExchanges)} />
      </div>

      <ExchangeBanner state={state} />

      <div className="mb-3 flex items-center justify-between gap-3">
        <Label>Queue now</Label>
        {action}
      </div>

      <LayoutGroup>
        <ol className="border-t border-obsidian">
          <AnimatePresence initial={false}>
            {state.queue.map((id, i) => {
              const p = state.parties[id]!
              const isBuyer = buyer === id
              const isMe = highlight === id
              return (
                <motion.li
                  key={id}
                  layout
                  transition={spring}
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  className={`grid grid-cols-[56px_1fr_auto] items-center gap-4 border-b border-obsidian py-4 md:grid-cols-[90px_1fr_auto_auto] md:gap-6 md:py-5 ${
                    isBuyer ? 'bg-signal/8' : ''
                  } ${isMe ? 'outline-2 -outline-offset-2 outline-obsidian' : ''}`}
                >
                  <motion.span layout="position" className="font-display text-4xl font-semibold tabular md:text-6xl">
                    {String(i + 1).padStart(2, '0')}
                  </motion.span>
                  <div className="min-w-0">
                    <p className="truncate font-display text-xl font-medium md:text-3xl">
                      {p.displayName}
                      {isMe && <span className="ml-2 align-middle font-mono text-xs uppercase">(you)</span>}
                      {p.status === 'serving' && <span className="ml-3 align-middle font-mono text-xs text-emerald uppercase">● ordering now</span>}
                      {p.lockedBy && (
                        <span className="ml-3 inline-flex items-center gap-1 align-middle font-mono text-xs text-obsidian/60 uppercase">
                          <Lock size={11} /> reserved
                        </span>
                      )}
                      {isBuyer && p.status === 'waiting' && !p.lockedBy && (
                        <span className="ml-3 align-middle font-mono text-xs text-signal uppercase">bought priority</span>
                      )}
                    </p>
                    <p className="truncate font-mono text-xs text-obsidian/60">
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
                  <div className="w-16 text-right md:w-24">
                    <p className="font-mono text-[10px] uppercase text-obsidian/50">Wait</p>
                    <p className="font-mono text-lg tabular md:text-xl">{formatDuration(waits[id] ?? 0)}</p>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
      </LayoutGroup>
      {state.queue.length === 0 && <p className="py-10 font-mono text-sm text-obsidian/50">Nobody is waiting right now.</p>}
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
      <p className={`font-display text-3xl font-semibold tabular md:text-4xl ${accent}`}>{value}</p>
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

export function Button({
  children,
  onClick,
  disabled,
  tone = 'outline',
  className = '',
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'outline' | 'solid' | 'signal'
  className?: string
  type?: 'button' | 'submit'
}) {
  const tones = {
    outline: 'border border-obsidian hover:bg-obsidian hover:text-ivory',
    solid: 'bg-obsidian text-ivory hover:bg-obsidian/85',
    signal: 'bg-signal text-white hover:bg-signal/90',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 px-3 py-2 font-mono text-xs uppercase transition-colors disabled:opacity-50 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  )
}

export { ArrowUpRight }
