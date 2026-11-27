'use client'

import { JoinQr } from '@/components/join-qr'
import { Header, LiveQueue, useNow } from '@/components/panels'
import { useVenue } from '@/lib/use-chronos'

export default function DisplayPage() {
  const { state, mode } = useVenue()
  const now = useNow()
  return (
    <main className="min-h-screen">
      <Header title="Live queue" mode={mode} />
      {state && (
        <div className="mx-auto grid max-w-7xl gap-2 xl:grid-cols-[1fr_auto]">
          <LiveQueue state={state} now={now} />
          <aside className="px-8 pt-8 xl:pl-0">
            <JoinQr />
          </aside>
        </div>
      )}
    </main>
  )
}
