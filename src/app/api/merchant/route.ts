import { z } from 'zod'
import { reconcileExchanges, venueTotals } from '@/domain/reconcile'
import { DEFAULT_DEMO_PASSCODE, isMerchant, loginMerchant, logoutMerchant, merchantPasscode } from '@/server/auth'
import { fail, json } from '@/server/http'
import { modeInfo, publicState, runtime } from '@/server/runtime'

export const dynamic = 'force-dynamic'

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), passcode: z.string().max(200) }),
  z.object({ action: z.literal('logout') }),
  z.object({ action: z.literal('serveNext') }),
  z.object({ action: z.literal('reset') }),
  z.object({ action: z.literal('cancelExchange'), exchangeId: z.string().max(80) }),
  z.object({ action: z.literal('reconcileExchange'), exchangeId: z.string().max(80) }),
  z.object({ action: z.literal('retryCapture'), partyId: z.string().max(80) }),
])

/** Merchant console data: full ledger and reconciliation. Requires a merchant session. */
export async function GET() {
  const showHint = merchantPasscode() === DEFAULT_DEMO_PASSCODE || process.env.CHRONOS_PUBLIC_DEMO === 'true'
  if (!(await isMerchant())) return json({ authenticated: false, demoPasscode: showHint ? merchantPasscode() : null })
  const state = await runtime().chronos.load()
  return json({
    authenticated: true,
    state: publicState(state),
    totals: venueTotals(state),
    reconciliation: reconcileExchanges(state),
    mode: modeInfo(),
  })
}

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return fail('Invalid request', 400)
  const input = parsed.data
  if (input.action === 'login') {
    return (await loginMerchant(input.passcode)) ? json({ ok: true }) : fail('Incorrect passcode', 401)
  }
  if (input.action === 'logout') {
    await logoutMerchant()
    return json({ ok: true })
  }
  if (!(await isMerchant())) return fail('Merchant sign-in required', 401)
  const { chronos } = runtime()
  switch (input.action) {
    case 'serveNext': {
      const r = await chronos.serveNext()
      return r.ok ? json(r.value) : fail(r.error)
    }
    case 'reset': {
      await chronos.reset()
      return json({ ok: true })
    }
    case 'cancelExchange': {
      const r = await chronos.cancelExchange(input.exchangeId, 'merchant')
      return r.ok ? json({ status: r.value.status }) : fail(r.error)
    }
    case 'reconcileExchange': {
      const r = await chronos.reconcileExchange(input.exchangeId)
      return r.ok ? json({ status: r.value.status }) : fail(r.error)
    }
    case 'retryCapture': {
      const r = await chronos.capture(input.partyId)
      return r.ok ? json({ ok: true }) : fail(r.error)
    }
  }
}
