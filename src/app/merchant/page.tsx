'use client'

import { Header, Ledger, LiveQueue, useNow } from '@/components/panels'
import { useChronos } from '@/lib/use-chronos'

export default function MerchantPage() {
  const { state, store, message, actions } = useChronos()
  const now = useNow()
  if (!state) return <div className="min-h-screen" />
  return (
    <main className="min-h-screen">
      <Header title="Café console" store={store} onReset={actions.reset} />
      {message && <p className="border-b border-signal px-8 py-2 font-mono text-xs text-signal">{message}</p>}
      <div className="grid lg:grid-cols-[1fr_420px]">
        <LiveQueue state={state} now={now} onServe={actions.serveNext} explain={false} />
        <Ledger state={state} />
      </div>
    </main>
  )
}
