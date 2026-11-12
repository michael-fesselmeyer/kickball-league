/**
 * Domain functions return a Result instead of throwing for expected
 * failures ("team is full", "deadline passed"), so callers must handle
 * each named failure. Only unexpected failures throw.
 * See docs/architecture.md, section 1 ("Errors").
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
