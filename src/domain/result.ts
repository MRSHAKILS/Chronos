export type Ok<T> = { ok: true; value: T }
export type Err<E = DomainError> = { ok: false; error: E }
export type Result<T, E = DomainError> = Ok<T> | Err<E>

export type DomainErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'invalid_target'
  | 'requester_not_waiting'
  | 'not_consented'
  | 'delay_exceeded'
  | 'below_min_charge'
  | 'below_payment_minimum'
  | 'stale_version'
  | 'quote_expired'
  | 'quote_not_found'
  | 'quote_mismatch'
  | 'party_serving'
  | 'exchange_conflict'
  | 'exchange_not_pending'
  | 'exchange_released'
  | 'amount_mismatch'
  | 'locked_in_exchange'
  | 'invalid_state'
  | 'queue_empty'

export interface DomainError {
  code: DomainErrorCode
  message: string
  /** Party the error relates to, if any. */
  partyId?: string
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = (code: DomainErrorCode, message: string, partyId?: string): Err => ({
  ok: false,
  error: partyId ? { code, message, partyId } : { code, message },
})
