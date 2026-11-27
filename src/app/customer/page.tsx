'use client'

import { CustomerPanel, Header, useNow } from '@/components/panels'
import { useChronos } from '@/lib/use-chronos'

export default function CustomerPage() {
  const chronos = useChronos()
  const now = useNow()
  if (!chronos.state) return <div className="min-h-screen" />
  return (
    <main className="mx-auto min-h-screen max-w-md">
      <Header title="Customer" store={chronos.store} />
      <CustomerPanel chronos={chronos} now={now} />
    </main>
  )
}
