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
    found =
      locale === "ht"
        ? creole(options)
        : new Intl.DateTimeFormat(locale, options);
    cache.set(key, found);
  }
  return found;
}

/**
 * The formatting data has no Haitian Creole, and its English fallback would
 * put "Saturday" on a Creole page. Creole dates follow French word order,
 * so the French formatter's output is used with the Creole day and month
 * names in place of the French ones.
 */
const CREOLE_WORDS: Readonly<Record<string, string>> = {
  lundi: "lendi",
  mardi: "madi",
  mercredi: "mèkredi",
  jeudi: "jedi",
  vendredi: "vandredi",
  samedi: "samdi",
  dimanche: "dimanch",
  "lun.": "len.",
  "mar.": "mad.",
  "mer.": "mèk.",
  "jeu.": "jed.",
  "ven.": "van.",
  "sam.": "sam.",
  "dim.": "dim.",
  janvier: "janvye",
  février: "fevriye",
  mars: "mas",
  avril: "avril",
  mai: "me",
  juin: "jen",
  juillet: "jiyè",
  août: "out",
  septembre: "septanm",
  octobre: "oktòb",
  novembre: "novanm",
  décembre: "desanm",
  "janv.": "jan.",
  "févr.": "fev.",
  "avr.": "avr.",
  "juil.": "jiy.",
  "sept.": "sept.",
  "oct.": "okt.",
  "nov.": "nov.",
  "déc.": "des.",
  à: "a",
};

const FRENCH_WORD = /[a-zàâçéèêëîïôûùüÿœ]+\.?/giu;

/** French day and month names in `text` swapped for the Creole ones. */
export function toCreole(text: string): string {
  return text.replace(FRENCH_WORD, (word) => {
    const found = CREOLE_WORDS[word.toLowerCase()];
    if (found === undefined) return word;
    return word[0] === word[0]?.toUpperCase()
      ? found.charAt(0).toUpperCase() + found.slice(1)
      : found;
  });
}

function creole(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const french = new Intl.DateTimeFormat("fr-HT", options);
  return {
    format: (date?: Date | number) => toCreole(french.format(date)),
    formatToParts: (date?: Date | number) =>
      french
        .formatToParts(date)
        .map((part) => ({ ...part, value: toCreole(part.value) })),
    formatRange: (a: Date | number, b: Date | number) =>
      toCreole(french.formatRange(a, b)),
    formatRangeToParts: (a: Date | number, b: Date | number) =>
      french
        .formatRangeToParts(a, b)
        .map((part) => ({ ...part, value: toCreole(part.value) })),
    resolvedOptions: () => french.resolvedOptions(),
  };
}
