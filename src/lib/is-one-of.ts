/**
 * Whether `value` is one of `list`'s items, narrowing it to their type: for a
 * string read from outside checked against a `const` list, with no cast.
 */
export function isOneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.some((item) => item === value);
}
