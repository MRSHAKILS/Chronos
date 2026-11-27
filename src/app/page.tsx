import Link from 'next/link'
import { ArrowUpRight, Clock, HandCoins, ShieldCheck } from 'lucide-react'

const screens = [
  { href: '/customer', n: '01', title: 'Customer', body: 'Open on a phone. Join the line and buy a faster spot.' },
  { href: '/display', n: '02', title: 'Live queue', body: 'Put on a big screen. Watch the line reorder as people pay.' },
  { href: '/merchant', n: '03', title: 'Café console', body: 'For staff. Serve customers and see where every cent went.' },
]

const how = [
  {
    icon: ShieldCheck,
    title: 'People ahead say yes, in advance',
    body: 'When you join, you can say: “let others pass me for $0.50, as long as it adds no more than 5 minutes.” No one is ever passed without agreeing.',
  },
  {
    icon: HandCoins,
    title: 'Someone in a hurry pays exactly that',
    body: 'Daniel wants to go first. He sees one clear price: the sum of what each person asked for, plus a small café fee.',
  },
  {
    icon: Clock,
    title: 'Time moves, money follows',
    body: 'Daniel jumps ahead. Everyone he passed waits a bit longer and gets their price off their order, automatically.',
  },
]

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12 md:px-10">
      <p className="font-mono text-[11px] tracking-[0.2em] uppercase">A fair way to skip the line</p>
      <h1 className="mt-2 font-display text-7xl font-semibold tracking-tight md:text-9xl">
        CHRONOS<span className="text-signal">.</span>
      </h1>
      <p className="mt-4 max-w-2xl font-display text-2xl md:text-3xl">
        Time is currency. In a hurry? Pay to go sooner. Not in a hurry? Get paid to wait.
      </p>

      <section id="how" className="mt-16 scroll-mt-8">
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-obsidian/70">How it works</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {how.map((h, i) => (
            <div key={h.title} className="glass p-6">
              <div className="flex items-center justify-between">
                <h.icon className="text-signal" />
                <span className="font-mono text-xs text-obsidian/50">0{i + 1}</span>
              </div>
              <p className="mt-6 font-display text-xl font-medium leading-tight">{h.title}</p>
              <p className="mt-2 text-sm text-obsidian/70">{h.body}</p>
            </div>
          ))}
        </div>

        <div className="glass mt-6 grid gap-6 p-6 md:grid-cols-[1fr_auto]">
          <div>
            <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-obsidian/70">The example in this demo</p>
            <p className="mt-2 max-w-xl text-sm text-obsidian/75">
              Alice, Bob and Charlie are waiting. Daniel is 4th and pays $1.75 to go 1st. Alice gets $0.50 off, Bob $0.75, Charlie
              $0.25, and the café keeps $0.25. Every cent is accounted for.
            </p>
          </div>
          <div className="space-y-1 self-center font-mono text-sm tabular">
            {[
              ['Alice', '$0.50'],
              ['Bob', '$0.75'],
              ['Charlie', '$0.25'],
              ['Café fee', '$0.25'],
            ].map(([k, v]) => (
              <div key={k} className="flex w-56 justify-between">
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}
            <div className="flex w-56 justify-between border-t border-dashed border-obsidian pt-1 font-semibold">
              <span>Daniel pays</span>
              <span className="text-signal">$1.75</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-16">
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-obsidian/70">Try it in 30 seconds</p>
        <p className="mt-2 text-sm text-obsidian/70">
          Open the live queue on one screen and the customer page on another (or scan the QR code on the queue with your phone).
          Then join, pick “Move to #1” and pay.
        </p>
        <div className="mt-6 grid border-t border-obsidian md:grid-cols-3">
          {screens.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group border-b border-obsidian py-6 md:border-r md:border-b-0 md:px-6 md:first:pl-0 md:last:border-r-0"
            >
              <p className="font-mono text-xs text-obsidian/60">{s.n}</p>
              <p className="mt-6 flex items-center justify-between font-display text-3xl font-medium group-hover:text-signal">
                {s.title} <ArrowUpRight />
              </p>
              <p className="mt-2 text-sm text-obsidian/70">{s.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-16 font-mono text-[11px] text-obsidian/50">Demo only. Payments are simulated and no real money moves.</p>
    </main>
  )
}
