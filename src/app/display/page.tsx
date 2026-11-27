'use client'

import { Header, LiveQueue, useNow } from '@/components/panels'
import { useChronos } from '@/lib/use-chronos'

export default function DisplayPage() {
  const { state } = useChronos()
  const now = useNow()
  if (!state) return <div className="min-h-screen" />
  return (
    <main className="min-h-screen">
      <Header title="Live exchange" />
      <div className="mx-auto max-w-6xl">
        <LiveQueue state={state} now={now} />
      </div>
    </main>
  )
}
