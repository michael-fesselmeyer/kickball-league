import type { GlobalRole } from "@/domain/authz/permissions";
import { type Block, blocksOf } from "./rules";

/**
 * The searchable rulebook (ADR 0086): who may read the league's rules, how a
 * section's text becomes numbered rules with anchors, and how a search is
 * turned into a Postgres query and into the rules that matched. Pure.
 */

export const RULEBOOK_VISIBILITIES = ["owners", "members", "public"] as const;
export type RulebookVisibility = (typeof RULEBOOK_VISIBILITIES)[number];

/** A new league shows nothing until its owners decide. */
export const DEFAULT_VISIBILITY: RulebookVisibility = "owners";

export const VISIBILITY_LABELS: Record<
  RulebookVisibility,
  { label: string; help: string }
> = {
  owners: {
    label: "Owners only",
    help: "Only the league's owners can read the rulebook.",
  },
  members: {
    label: "Members only",
    help: "Anyone with an account can read it in the app.",
  },
  public: {
    label: "Public",
    help: "Anyone can read it on the public rules page.",
  },
};

export function parseVisibility(value: unknown): RulebookVisibility | null {
  return RULEBOOK_VISIBILITIES.find((v) => v === value) ?? null;
}

/**
 * Whether a person with this role in the league may read the rulebook text.
 * `role` is null for a visitor. Admins who are not owners are members here:
 * the owners decide what the rest of the league sees.
 */
export function canReadRulebook(
  visibility: RulebookVisibility,
  role: GlobalRole | null,
): boolean {
  if (visibility === "public") return true;
  if (role === null) return false;
  if (visibility === "members") return true;
  return role === "owner";
}

/** A rule inside a section: its number as written, or none for plain text. */
export type NumberedBlock =
  | { kind: "rule"; number: string; anchor: string; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/** "3.", "3)" or a dotted "3.1": a bare number is not a rule number. */
const RULE_NUMBER = /^(\d+(?:\.\d+)+[.)]?|\d+[.)])\s+(\S[\s\S]*)$/;

/** The id of a rule's anchor: unique across the page and stable. */
export function ruleAnchor(sectionSlug: string, number: string): string {
  return `rule-${sectionSlug}--${number.replace(/[^0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** The text's blocks, with a rule number and anchor on each numbered paragraph. */
export function numberedBlocksOf(
  sectionSlug: string,
  body: string,
): NumberedBlock[] {
  const used = new Set<string>();
  return blocksOf(body).map((b: Block): NumberedBlock => {
    if (b.kind === "list") return b;
    const m = RULE_NUMBER.exec(b.text);
    if (!m?.[1] || !m[2]) return b;
    const number = m[1].replace(/[.)]$/, "");
    let anchor = ruleAnchor(sectionSlug, number);
    // A repeated number still gets its own anchor.
    for (let n = 2; used.has(anchor); n++)
      anchor = `${ruleAnchor(sectionSlug, number)}-${n}`;
    used.add(anchor);
    return { kind: "rule", number, anchor, text: m[2] };
  });
}

export const MAX_SEARCH_TERMS = 8;
export const MAX_QUERY_LENGTH = 80;

/**
 * The words of a search, lower-case, accents dropped, letters and digits
 * only, so nothing typed can change the shape of the database query.
 */
export function searchTerms(query: string): string[] {
  const words =
    query
      .slice(0, MAX_QUERY_LENGTH)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words)].slice(0, MAX_SEARCH_TERMS);
}

/**
 * The Postgres `to_tsquery` text for the terms: every word must appear, and
 * each matches as a prefix so results arrive while the person is typing.
 * Null when there is nothing to search for.
 */
export function tsQueryOf(terms: readonly string[]): string | null {
  return terms.length === 0 ? null : terms.map((t) => `${t}:*`).join(" & ");
}

/** A word with its common endings off, so "kicking" finds "kick". */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  return word.replace(/(ing|ed|es|s)$/, "");
}

/** How many of the terms start a word in the text. */
function termsIn(text: string, terms: readonly string[]): number {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let hits = 0;
  for (const term of terms) {
    const s = stem(term);
    if (words.some((w) => w.startsWith(s))) hits++;
  }
  return hits;
}

export type RuleHit = {
  /** The rule's anchor; null when the match is in unnumbered text. */
  anchor: string | null;
  number: string | null;
  snippet: string;
};

const SNIPPET = 140;

function snippetOf(text: string, terms: readonly string[]): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= SNIPPET) return clean;
  const lower = clean.toLowerCase();
  const at = Math.min(
    ...terms.map((t) => lower.indexOf(stem(t))).filter((i) => i >= 0),
    clean.length,
  );
  const start = Math.max(0, at - 40);
  const cut = clean.slice(start, start + SNIPPET).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + SNIPPET < clean.length ? "…" : ""}`;
}

/**
 * The rules in a section that contain the search words, best match first, so
 * a result can jump to the rule instead of the top of its section.
 */
export function rulesMatching(
  sectionSlug: string,
  body: string,
  terms: readonly string[],
  limit = 3,
): RuleHit[] {
  const scored: { hit: RuleHit; score: number; order: number }[] = [];
  numberedBlocksOf(sectionSlug, body).forEach((b, order) => {
    const text = b.kind === "list" ? b.items.join(" ") : b.text;
    const score = termsIn(text, terms);
    if (score === 0) return;
    scored.push({
      score,
      order,
      hit: {
        anchor: b.kind === "rule" ? b.anchor : null,
        number: b.kind === "rule" ? b.number : null,
        snippet: snippetOf(text, terms),
      },
    });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.hit);
}
