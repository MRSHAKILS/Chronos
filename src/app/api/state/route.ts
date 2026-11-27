import { NextResponse } from 'next/server'
import { actionSchema, applyAction, makeIds, seedState } from '@/server/actions'
import { loadState, mutateState, storeKind } from '@/server/store'

export const dynamic = 'force-dynamic'

const seed = () => seedState(Date.now())

export async function GET() {
  const { rev, state } = await loadState(seed)
  return NextResponse.json({ rev, state, store: storeKind }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  const ids = makeIds()
  const result = await mutateState(seed, (s) => applyAction(s, parsed.data, Date.now(), ids))
  if (!result.ok) return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: 409 })
  return NextResponse.json({ state: result.value.state, quote: result.value.value.quote ?? null })
}
