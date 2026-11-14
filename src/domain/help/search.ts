/**
 * The help center's search: every word typed must appear somewhere in an
 * article's title, summary or keywords. Titles that match rank first. Pure
 * and small, so it runs in the browser with no index to download.
 */

export type HelpEntry = {
  href: string;
  title: string;
  summary: string;
  /** The role it's for, as the results show it ("Captains"). */
  role: string;
  keywords: readonly string[];
};

/** Lowercase, accents and punctuation removed, hyphens read as spaces. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const words = (text: string) => normalize(text).split(" ").filter(Boolean);

/** Matching entries, best first; nothing for an empty query. */
export function searchHelp<E extends HelpEntry>(
  entries: readonly E[],
  query: string,
): E[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const scored: { entry: E; score: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const title = ` ${normalize(entry.title)} `;
    const rest = ` ${normalize(
      [entry.summary, entry.role, ...entry.keywords].join(" "),
    )} `;
    let score = 0;
    for (const term of terms) {
      // A word that starts with the term counts: "pay" finds "payment".
      const needle = ` ${term}`;
      if (title.includes(needle)) score += 2;
      else if (rest.includes(needle)) score += 1;
      else return;
    }
    scored.push({ entry, score, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((s) => s.entry);
}
