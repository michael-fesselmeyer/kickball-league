/** "Spring 2027 — Mondays" → "spring-2027-mondays". Empty when nothing is left. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A team's slug: its name's, or, for a name with no Latin letters or digits
 * left once slugified (Arabic, Hebrew, Japanese, only emoji), a stable code
 * made from the name, so the team can still register and have a page. The
 * same name always gives the same code, so a taken name is still caught.
 * Empty only when the name has no letter, digit or emoji at all.
 */
export function teamSlug(name: string): string {
  const slug = slugify(name);
  if (slug) return slug;
  const text = name.trim().normalize("NFC");
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text)) return "";
  // FNV-1a over the code points: short, stable and good enough to tell
  // names apart in one league.
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `team-${hash.toString(36)}`;
}
