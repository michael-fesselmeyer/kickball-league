/**
 * Type guards for values that come from outside the type system: form
 * fields, query strings and stored JSON. Use these instead of `as`, so the
 * check and the type cannot drift apart.
 */

/** Whether `value` is one of `options`, narrowing it to that union. */
export function isOneOf<const Options extends readonly string[]>(
  options: Options,
  value: unknown,
): value is Options[number] {
  return typeof value === "string" && options.includes(value);
}

/**
 * A record with exactly `keys`, each set by `value`. Object.fromEntries
 * cannot type its result, so the one assertion it needs lives here.
 */
export function recordOf<const Keys extends readonly string[], Value>(
  keys: Keys,
  value: (key: Keys[number]) => Value,
): Record<Keys[number], Value> {
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<
    Keys[number],
    Value
  >;
}
