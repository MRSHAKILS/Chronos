import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

const screens = [
  { href: '/customer', n: '01', title: 'Customer', body: 'Mobile. Join the queue, see your position, buy priority with a transparent quote.' },
  { href: '/display', n: '02', title: 'Live display', body: 'Presentation screen. The animated queue, compensation paid and merchant revenue.' },
  { href: '/merchant', n: '03', title: 'Merchant', body: 'Console. Serve customers, capture discounted orders, inspect the ledger.' },
]

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12 md:px-10">
      <p className="font-mono text-[11px] tracking-[0.2em] uppercase">Consent-based time exchange</p>
      <h1 className="mt-2 font-display text-7xl font-semibold tracking-tight md:text-9xl">
        CHRONOS<span className="text-signal">.</span>
      </h1>
      <p className="mt-4 max-w-xl font-display text-2xl">
        Time is currency. Buy priority, or get paid to wait. Everyone overtaken agreed to the price.
      </p>
      <div className="mt-14 grid border-t border-obsidian md:grid-cols-3">
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
      <p className="mt-12 font-mono text-xs text-obsidian/60">
        Open the three screens in separate tabs or windows of the same browser. They stay in sync.
      </p>
    </main>
  )
}
