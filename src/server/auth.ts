import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import type { VenueState } from '@/domain/types'
import { hashToken } from './lifecycle'

const PARTY_COOKIE = 'chronos_party'
const MERCHANT_COOKIE = 'chronos_merchant'
const MERCHANT_TTL_MS = 12 * 60 * 60 * 1000
export const DEFAULT_DEMO_PASSCODE = 'chronos-demo'

const secure = process.env.NODE_ENV === 'production'

export function merchantPasscode(): string {
  return process.env.MERCHANT_PASSCODE?.trim() || DEFAULT_DEMO_PASSCODE
}

function sessionSecret(): string {
  const v = process.env.SESSION_SECRET?.trim()
  if (v && v.length >= 32) return v
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET (32+ characters) must be set in production')
  return 'chronos-local-development-secret-do-not-use-in-production'
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/* Customer sessions: a random token in an httpOnly cookie; only its SHA-256 is stored. */

export async function setPartyToken(token: string) {
  ;(await cookies()).set(PARTY_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 6 })
}

export async function clearPartyToken() {
  ;(await cookies()).delete(PARTY_COOKIE)
}

export async function currentPartyId(state: VenueState): Promise<string | null> {
  const token = (await cookies()).get(PARTY_COOKIE)?.value
  if (!token) return null
  const hash = hashToken(token)
  const party = Object.values(state.parties).find((p) => p.tokenHash && safeEqual(p.tokenHash, hash))
  return party?.id ?? null
}

/* Merchant sessions: an expiring, HMAC-signed cookie issued after the passcode check. */

function sign(value: string) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
}

export async function loginMerchant(passcode: string): Promise<boolean> {
  if (!safeEqual(passcode, merchantPasscode())) return false
  const exp = String(Date.now() + MERCHANT_TTL_MS)
  ;(await cookies()).set(MERCHANT_COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: MERCHANT_TTL_MS / 1000,
  })
  return true
}

export async function logoutMerchant() {
  ;(await cookies()).delete(MERCHANT_COOKIE)
}

export async function isMerchant(): Promise<boolean> {
  const value = (await cookies()).get(MERCHANT_COOKIE)?.value
  if (!value) return false
  const [exp, sig] = value.split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  return safeEqual(sig, sign(exp))
}
