/**
 * `value`, which an invariant of the caller says is there: a row just written,
 * a key the map was built from. Throws an `Error` that states the invariant when
 * it does not hold, where `value!` would let `undefined` through.
 */
export function present<T>(value: T | null | undefined, invariant: string): T {
  if (value === null || value === undefined) {
    throw new Error(invariant);
  }
  return value;
}
