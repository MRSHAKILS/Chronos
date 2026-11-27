import { NextResponse } from 'next/server'
import type { DomainError } from '@/domain/result'

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export const fail = (error: DomainError | string, status = 409) =>
  json(typeof error === 'string' ? { error } : { error: error.message, code: error.code }, status)
