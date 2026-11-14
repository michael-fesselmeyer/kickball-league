/**
 * Building an Intl.DateTimeFormat costs about seven times as much as using
 * one, and a season's pages convert thousands of kickoff times between UTC
 * and the league's zone. Formatters are kept per locale and options, so each
 * zone's is built once per server instance. The set of zones and option
 * shapes is small and fixed by the code, so the cache stays small.
 */
const cache = new Map<string, Intl.DateTimeFormat>();

export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    cache.set(key, found);
  }
  return found;
}
