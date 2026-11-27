'use client'

import { CustomerPanel, Header, useNow } from '@/components/panels'
import { useChronos } from '@/lib/use-chronos'

export default function CustomerPage() {
  const { state, message, actions } = useChronos()
  const now = useNow()
  if (!state) return <div className="min-h-screen" />
  return (
    <main className="mx-auto min-h-screen max-w-md border-l border-obsidian">
      <Header title="Customer" />
      <CustomerPanel state={state} actions={actions} message={message} now={now} />
    </main>
  )
}
