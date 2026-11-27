import { json } from '@/server/http'
import { modeInfo, publicState, runtime } from '@/server/runtime'

export const dynamic = 'force-dynamic'

/** Public, sanitised venue state for the display and customer screens. */
export async function GET() {
  const { chronos } = runtime()
  let state = await chronos.load()
  if (Object.values(state.exchanges).some((e) => e.status === 'pending')) {
    await chronos.sweep()
    state = await chronos.load()
  }
  return json({ state: publicState(state), mode: modeInfo() })
}
