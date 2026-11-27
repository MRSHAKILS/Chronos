'use client'

import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Check, Clock, CreditCard, Loader2, LogOut, Settings2, ShieldCheck, UserPlus, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MENU } from '@/domain/demo'
import { formatCents, formatDuration } from '@/domain/money'
import { estimateWaits } from '@/domain/queue'
import { quoteLadder } from '@/domain/quote'
import type { Party, Quote, VenueState } from '@/domain/types'
import { useCustomer, useVenue, type JoinInput, type Mode, type PurchaseResult } from '@/lib/use-chronos'
import { Button, Header, Label, Row, useNow } from './panels'

const STEPS = ['Join', 'Choose a spot', 'Pay', 'Done']

function Stepper({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="space-y-1" aria-current={i === step ? 'step' : undefined}>
          <div className={`h-1 ${i <= step ? 'bg-signal' : 'bg-obsidian/15'} transition-colors`} />
          <p className={`font-mono text-[10px] uppercase ${i === step ? 'text-obsidian' : 'text-obsidian/45'}`}>{s}</p>
        </li>
      ))}
    </ol>
  )
}

export function CustomerApp() {
  const venue = useVenue()
  const customer = useCustomer(venue.refresh)
  const now = useNow()
  const handledReturn = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Returning from Stripe Checkout: confirm from the server's view of Stripe, never from the URL.
  useEffect(() => {
    if (handledReturn.current || customer.partyId === undefined) return
    handledReturn.current = true
    const params = new URLSearchParams(window.location.search)
    const exchangeId = params.get('exchange')
    const run = async () => {
      if (exchangeId) {
        const r = params.get('cancelled') ? await customer.cancel(exchangeId) : await customer.reconcile(exchangeId)
        if (r) {
          setNotice(
            r.status === 'confirmed'
              ? 'Payment confirmed by Stripe. Your new place is locked in.'
              : r.status === 'pending'
                ? 'Waiting for Stripe to confirm your payment…'
                : 'Checkout was not completed. Your place has not changed.',
          )
        }
      }
      if (params.has('authorized')) await customer.refreshAuthorization()
      if (exchangeId || params.has('authorized')) window.history.replaceState(null, '', '/customer')
    }
    void run()
  }, [customer])

  const { state, mode } = venue
  const me = customer.partyId && state ? state.parties[customer.partyId] : undefined

  return (
    <main className="mx-auto min-h-screen max-w-md">
      <Header title="Customer" mode={mode} />
      {!state || customer.partyId === undefined ? (
        <div className="flex items-center gap-2 p-6 font-mono text-xs uppercase">
          <Loader2 size={14} className="animate-spin" /> Loading the queue…
        </div>
      ) : (
        <section className="space-y-6 p-5">
          {notice && (
            <p className="flex items-start justify-between gap-2 border-l-2 border-emerald bg-emerald/5 px-3 py-2 text-sm">
              {notice}
              <button onClick={() => setNotice(null)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </p>
          )}
          {!me ? (
            <>
              <Stepper step={0} />
              <JoinForm state={state} mode={mode} customer={customer} />
            </>
          ) : (
            <MyQueue state={state} me={me} now={now} mode={mode} customer={customer} />
          )}
          {customer.message && <p className="border-l-2 border-signal pl-2 text-xs text-signal">{customer.message}</p>}
        </section>
      )}
    </main>
  )
}

type Customer = ReturnType<typeof useCustomer>

/* ─────────────────────────── Join ─────────────────────────── */

function ConsentFields({ value, onChange, disabled }: { value: JoinInput['consent']; onChange: (v: JoinInput['consent']) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={value.optIn}
          onChange={(e) => onChange({ ...value, optIn: e.target.checked })}
          className="mt-1 h-4 w-4 accent-signal"
        />
        <span>
          <span className="block text-sm font-medium">Let people in a hurry pass me</span>
          <span className="block text-xs text-obsidian/60">You get paid as a discount on your order. You can change this until someone pays.</span>
        </span>
      </label>
      {value.optIn && (
        <div className="space-y-3 border-l-2 border-signal/40 pl-3">
          <label className="block">
            <span className="flex justify-between text-xs">
              <span>My price each time someone passes me</span>
              <span className="font-mono font-semibold">{formatCents(value.minCompensationCents)}</span>
            </span>
            <input
              type="range"
              min={25}
              max={300}
              step={25}
              value={value.minCompensationCents}
              onChange={(e) => onChange({ ...value, minCompensationCents: Number(e.target.value) })}
              className="w-full accent-signal"
            />
          </label>
          <label className="block">
            <span className="flex justify-between text-xs">
              <span>Most extra waiting I’ll accept in total</span>
              <span className="font-mono font-semibold">{formatDuration(value.maxAdditionalDelaySec)}</span>
            </span>
            <input
              type="range"
              min={60}
              max={900}
              step={30}
              value={value.maxAdditionalDelaySec}
              onChange={(e) => onChange({ ...value, maxAdditionalDelaySec: Number(e.target.value) })}
              className="w-full accent-signal"
            />
          </label>
        </div>
      )}
    </fieldset>
  )
}

function JoinForm({ state, mode, customer }: { state: VenueState; mode: Mode | null; customer: Customer }) {
  const [name, setName] = useState('Daniel')
  const [sku, setSku] = useState('cold-brew')
  const [consent, setConsent] = useState<JoinInput['consent']>({ optIn: true, minCompensationCents: 50, maxAdditionalDelaySec: 600 })
  const [payWithCard, setPayWithCard] = useState(false)
  const stripe = mode?.payments === 'stripe_sandbox'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = await customer.join({ name: name.trim(), sku, consent, payWithCard: stripe && payWithCard })
    if (r?.authorizationUrl) window.location.href = r.authorizationUrl
  }

  return (
    <form onSubmit={submit} className="glass space-y-5 p-5">
      <div>
        <p className="font-display text-2xl leading-tight">Join the queue at {state.config.name}</p>
        <p className="mt-1 text-sm text-obsidian/70">
          {state.queue.length} {state.queue.length === 1 ? 'person is' : 'people are'} waiting. After joining you can{' '}
          <b>pay the people ahead of you to go first</b>, but only those who agreed to it, at the price they chose.
        </p>
      </div>

      <label className="block">
        <span className="font-mono text-[11px] uppercase text-obsidian/70">Your first name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          required
          className="mt-1 w-full border border-obsidian bg-ivory/70 px-3 py-2 text-base outline-none focus:border-signal"
        />
      </label>

      <div>
        <span className="font-mono text-[11px] uppercase text-obsidian/70">Your order</span>
        <div className="mt-1 divide-y divide-obsidian/15 border border-obsidian bg-ivory/60">
          {MENU.map((m) => (
            <label key={m.sku} className={`flex cursor-pointer items-center justify-between px-3 py-2 ${sku === m.sku ? 'bg-signal/10' : ''}`}>
              <span className="flex items-center gap-2">
                <input type="radio" name="sku" checked={sku === m.sku} onChange={() => setSku(m.sku)} className="accent-signal" />
                <span>
                  <span className="block text-sm">{m.name}</span>
                  <span className="block text-[11px] text-obsidian/55">
                    {m.note} · ~{formatDuration(m.serviceSec)} to make
                  </span>
                </span>
              </span>
              <span className="font-mono text-sm">{formatCents(m.cents)}</span>
            </label>
          ))}
        </div>
      </div>

      <ConsentFields value={consent} onChange={setConsent} />

      {stripe && (
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={payWithCard} onChange={(e) => setPayWithCard(e.target.checked)} className="mt-1 h-4 w-4 accent-signal" />
          <span>
            <span className="flex items-center gap-1 text-sm font-medium">
              <CreditCard size={14} /> Pre-authorize my order with a card
            </span>
            <span className="block text-xs text-obsidian/60">
              Stripe test mode: use card 4242 4242 4242 4242. You’re charged only the final amount after any discounts.
            </span>
          </span>
        </label>
      )}

      <Button type="submit" tone="solid" disabled={customer.busy || !name.trim()} className="w-full py-3 text-sm">
        <UserPlus size={16} /> Join the queue
      </Button>
    </form>
  )
}

/* ─────────────────────────── In the queue ─────────────────────────── */

function MyQueue({ state, me, now, mode, customer }: { state: VenueState; me: Party; now: number; mode: Mode | null; customer: Customer }) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [checkout, setCheckout] = useState<PurchaseResult | null>(null)
  const [editing, setEditing] = useState(false)
  const inQueue = state.queue.includes(me.id)
  const position = state.queue.indexOf(me.id) + 1
  const waits = estimateWaits(state, now)
  const pending = Object.values(state.exchanges).find((e) => e.status === 'pending' && e.quote.requesterId === me.id)
  const confirmed = Object.values(state.exchanges)
    .filter((e) => e.status === 'confirmed' && e.quote.requesterId === me.id)
    .sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0))[0]
  const ladder = inQueue && me.status === 'waiting' && !pending ? quoteLadder(state, me.id, now) : []
  const step = me.status !== 'waiting' || confirmed ? 3 : pending || quote ? 2 : 1

  const buy = async (q: Quote) => {
    const r = await customer.purchase(q.id)
    setQuote(null)
    if (!r) return
    if (r.url) window.location.href = r.url
    else setCheckout(r)
  }

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      <div className="glass space-y-5 p-5">
        {inQueue ? (
          <div className="flex items-baseline justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase">{me.status === 'serving' ? 'Your order' : 'Your place in line'}</p>
              {me.status === 'serving' ? (
                <p className="font-display text-3xl font-semibold text-emerald">Being made now</p>
              ) : (
                <motion.p
                  key={position}
                  initial={{ scale: 1.3, color: '#FF5722' }}
                  animate={{ scale: 1, color: '#141414' }}
                  className="font-display text-6xl font-semibold tabular"
                >
                  #{position}
                </motion.p>
              )}
            </div>
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase">Wait before your turn</p>
              <p className="font-mono text-2xl tabular">{formatDuration(waits[me.id] ?? 0)}</p>
            </div>
          </div>
        ) : (
          <Served me={me} onRestart={customer.restart} />
        )}

        {pending && (
          <div className="space-y-2 border border-obsidian/30 p-3">
            <p className="flex items-center gap-2 text-sm">
              <Loader2 size={14} className="animate-spin" /> Waiting for payment confirmation ({formatCents(pending.quote.totalCents)})
            </p>
            <p className="text-xs text-obsidian/60">Your spot and the people you’re passing are reserved until payment is confirmed or cancelled.</p>
            <Button onClick={() => customer.cancel(pending.id)} disabled={customer.busy}>
              Cancel purchase
            </Button>
          </div>
        )}

        {quote && !pending && <Receipt quote={quote} busy={customer.busy} mode={mode} onPay={() => buy(quote)} onCancel={() => setQuote(null)} />}

        {!quote && ladder.length > 0 && (
          <div>
            <p className="font-display text-lg leading-tight">Want to go sooner?</p>
            <p className="mb-3 text-xs text-obsidian/65">Pick a spot. You pay each person you pass the price they set, plus a small café fee.</p>
            <div className="divide-y divide-obsidian/15 border border-obsidian bg-ivory/60">
              {ladder.map((s) => (
                <button
                  key={s.targetPosition}
                  disabled={!s.available || customer.busy}
                  onClick={() => customer.quote(s.targetPosition).then(setQuote)}
                  className="group flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-signal/10 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span>
                    <span className="font-mono text-sm font-semibold">Move to #{s.targetPosition}</span>
                    <span className="block text-[11px] text-obsidian/60">
                      pass {position - s.targetPosition} {position - s.targetPosition === 1 ? 'person' : 'people'}
                      {s.available && ` · save ${formatDuration(s.quote.timeSavedSec)}`}
                    </span>
                  </span>
                  {s.available ? (
                    <span className="flex items-center gap-2 font-mono text-sm font-semibold tabular">
                      {formatCents(s.quote.totalCents)} <ArrowUpRight size={14} className="opacity-40 group-hover:opacity-100" />
                    </span>
                  ) : (
                    <span className="max-w-[160px] text-right text-[11px]">{s.reason.message}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {confirmed && !quote && !pending && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-1 border border-emerald/40 bg-emerald/5 p-3">
            <p className="flex items-center gap-2 font-display text-lg text-emerald">
              <Check size={18} /> You moved from #{confirmed.quote.fromPosition} to #{confirmed.quote.targetPosition}
            </p>
            <p className="text-xs text-obsidian/75">
              You paid {formatCents(confirmed.quote.totalCents)} and saved {formatDuration(confirmed.quote.timeSavedSec)}.{' '}
              {confirmed.quote.affected.map((a) => `${a.displayName} got ${formatCents(a.compensationCents)} off`).join(', ')}.
            </p>
          </motion.div>
        )}

        {inQueue && me.status === 'waiting' && ladder.length === 0 && !pending && !confirmed && position === 1 && (
          <p className="flex items-center gap-2 text-sm text-emerald">
            <ShieldCheck size={16} /> You’re next.
          </p>
        )}
      </div>

      <OrderSummary me={me} />

      {inQueue && me.status === 'waiting' && (
        <div className="space-y-3">
          <button onClick={() => setEditing((v) => !v)} className="flex items-center gap-2 font-mono text-[11px] uppercase hover:text-signal">
            <Settings2 size={13} /> {editing ? 'Close' : 'My settings for being passed'}
          </button>
          {editing && <ConsentEditor me={me} customer={customer} />}
          {!me.lockedBy && (
            <button onClick={customer.leave} className="flex items-center gap-2 font-mono text-[11px] uppercase text-obsidian/60 hover:text-signal">
              <LogOut size={13} /> Leave the queue
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {checkout && (
          <SimulatedCheckout
            checkout={checkout}
            busy={customer.busy}
            onResolve={async (outcome) => {
              await customer.simulatedCheckout(checkout.sessionId, outcome)
              setCheckout(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function OrderSummary({ me }: { me: Party }) {
  const final = me.orderTotalCents - me.earnedDiscountCents
  return (
    <div>
      <Label>Your order</Label>
      <div className="mt-2 space-y-1 font-mono text-xs tabular">
        {me.orderItems.map((i) => (
          <Row key={i.sku} k={i.name} v={formatCents(i.cents)} />
        ))}
        {me.earnedDiscountCents > 0 && (
          <Row k={`Earned for waiting +${formatDuration(me.addedDelaySec)}`} v={`−${formatCents(me.earnedDiscountCents)}`} tone="text-emerald" />
        )}
        <div className="border-t border-dashed border-obsidian pt-1">
          <Row k="You’ll pay" v={formatCents(me.finalChargeCents ?? final)} bold />
        </div>
        <p className="pt-1 font-sans text-[11px] text-obsidian/55">{paymentLabel(me)}</p>
      </div>
    </div>
  )
}

function paymentLabel(p: Party): string {
  switch (p.payment.kind) {
    case 'none':
      return 'Pay at the counter.'
    case 'simulated':
      return p.payment.status === 'captured' ? `Simulated card charged ${formatCents(p.payment.capturedCents ?? 0)}.` : 'Simulated card on file (no real money).'
    case 'stripe': {
      const s = p.payment.status
      if (s === 'pending') return 'Waiting for Stripe to confirm your card authorization…'
      if (s === 'authorized') return `Stripe test card authorized for ${formatCents(p.payment.authorizedCents)}. Only the final amount will be captured.`
      if (s === 'captured') return `Stripe captured ${formatCents(p.payment.capturedCents ?? 0)} of the ${formatCents(p.payment.authorizedCents)} authorized.`
      if (s === 'capture_failed') return `Capture failed: ${p.payment.lastError ?? 'unknown error'}. The café will retry.`
      return 'Card authorization was not completed. Pay at the counter.'
    }
  }
}

function Served({ me, onRestart }: { me: Party; onRestart: () => void }) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 font-display text-2xl">
        <Check className="text-emerald" /> {me.status === 'left' ? 'You left the queue' : 'Enjoy your coffee'}
      </p>
      {me.finalChargeCents !== undefined && (
        <p className="text-sm text-obsidian/70">
          Final charge {formatCents(me.finalChargeCents)}
          {me.earnedDiscountCents > 0 && `, including ${formatCents(me.earnedDiscountCents)} you earned by letting others pass`}.
        </p>
      )}
      <Button tone="solid" onClick={onRestart}>
        <UserPlus size={14} /> Join again
      </Button>
    </div>
  )
}

function ConsentEditor({ me, customer }: { me: Party; customer: Customer }) {
  const [value, setValue] = useState({
    optIn: me.consent.optIn,
    minCompensationCents: me.consent.minCompensationCents,
    maxAdditionalDelaySec: Math.max(60, me.consent.maxAdditionalDelaySec),
  })
  const locked = Boolean(me.lockedBy)
  return (
    <div className="glass space-y-3 p-4">
      {locked && <p className="text-xs text-signal">Locked while a purchase involving you is being paid.</p>}
      <ConsentFields value={value} onChange={setValue} disabled={locked} />
      <Button tone="solid" onClick={() => customer.updateConsent(value)} disabled={locked || customer.busy}>
        Save settings
      </Button>
    </div>
  )
}

/* ─────────────────────────── Quote & checkout ─────────────────────────── */

function Receipt({ quote, busy, mode, onPay, onCancel }: { quote: Quote; busy: boolean; mode: Mode | null; onPay: () => void; onCancel: () => void }) {
  const now = useNow()
  const secondsLeft = Math.max(0, Math.round((quote.expiresAt - now) / 1000))
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
        <button
          onClick={onPay}
          disabled={busy || secondsLeft === 0}
          className="flex items-center justify-center gap-2 bg-signal py-3 font-mono text-sm text-white uppercase disabled:opacity-60"
        >
          <Zap size={16} /> Pay {formatCents(quote.totalCents)}
        </button>
        <button onClick={onCancel} className="border-l border-obsidian px-4 font-mono text-xs uppercase">
          Back
        </button>
      </div>
      <p className="border-t border-obsidian/15 px-3 py-2 text-[10px] text-obsidian/55">
        {secondsLeft > 0 ? `Price locked for ${secondsLeft}s.` : 'Price expired. Go back and pick again.'}{' '}
        {mode?.payments === 'stripe_sandbox' ? 'Stripe test mode: use card 4242 4242 4242 4242.' : 'Simulated payment, no card is charged.'}
      </p>
    </motion.div>
  )
}

function SimulatedCheckout({ checkout, busy, onResolve }: { checkout: PurchaseResult; busy: boolean; onResolve: (o: 'paid' | 'declined') => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end justify-center bg-obsidian/40 p-4 sm:items-center">
      <motion.div
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        role="dialog"
        aria-label="Simulated checkout"
        className="w-full max-w-sm space-y-4 border border-obsidian bg-ivory p-5 shadow-[0_30px_80px_-20px_rgb(20_20_20/0.5)]"
      >
        <p className="font-mono text-[11px] tracking-[0.18em] text-signal uppercase">Simulated checkout · no real money</p>
        <p className="font-display text-3xl font-semibold tabular">{formatCents(checkout.amountCents)}</p>
        <p className="text-sm text-obsidian/70">
          In production this is a Stripe Checkout page. Here you decide the outcome, and the server confirms it through the same
          reconciliation path a real payment uses.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button tone="signal" disabled={busy} onClick={() => onResolve('paid')} className="py-3">
            Approve payment
          </Button>
          <Button disabled={busy} onClick={() => onResolve('declined')} className="py-3">
            Decline
          </Button>
        </div>
        <p className="font-mono text-[10px] text-obsidian/50">Session {checkout.sessionId}</p>
      </motion.div>
    </motion.div>
  )
}
