import { err, ok, type Result } from "@/domain/result";
import {
  BODY_MAX,
  type CurrentSection,
  type SubmittedSection,
  TITLE_MAX,
} from "./rules";

/**
 * Splits pasted rulebook text into sections and rules for an owner to review
 * before saving (ADR 0065). Pure: it never reads or keeps the text. The
 * result is a suggestion; the review step lets the owner fix it.
 */

export type ImportedSection = { title: string; body: string };

export type ImportSplit = {
  sections: ImportedSection[];
  /** Things to look at in the review, in plain words. */
  warnings: string[];
};

/** Longest text taken in one import, about a hundred pages. */
export const IMPORT_MAX = 300_000;

const PAGE_NUMBER = /^\s*(?:page\s+)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?\s*$/i;
const RULE_START = /^\(?(?:\d+(?:\.\d+)+[.)]?|\d+[.)])\s+\S/;
const BULLET = /^(?:[-*•–]\s+|\(?[a-z][.)]\s+)\S/;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /(^|[\s/-])([a-z])/g,
      (_, a: string, b: string) => a + b.toUpperCase(),
    );
}

/** A heading the author clearly marked: markdown, "Section 3", or ALL CAPS. */
function strongHeading(line: string): string | null {
  const t = line.trim();
  const md = /^#{1,3}\s+(\S.*)$/.exec(t);
  if (md?.[1]) return clean(md[1]).replace(/^\d+[.)]?\s+/, "");
  const word =
    /^(?:section|article|part|chapter)\s+(?:\d+|[ivxlc]+)\s*[:.\-–—)]?\s*(.*)$/i.exec(
      t,
    );
  if (word) return clean(word[1] || t);
  if (
    t.length >= 3 &&
    t.length <= 70 &&
    /^[A-Z0-9][A-Z0-9 &'/,\-–]*$/.test(t) &&
    (t.match(/[A-Z]/g)?.length ?? 0) >= 3 &&
    !/^\d/.test(t)
  )
    return titleCase(t);
  return null;
}

/** "3. Pitching": a short numbered line that is not a sentence. */
function numberedHeading(line: string): string | null {
  const m = /^\d{1,2}[.)]\s+(\S.{0,78})$/.exec(line.trim());
  const title = m?.[1];
  if (!title || /[.,;:!?]$/.test(title) || /^[a-z]/.test(title)) return null;
  return clean(title);
}

type Block = { kind: "rule" | "bullet" | "text"; text: string };

/** One section's lines as rules, each on its own paragraph, wrapping undone. */
function bodyOf(lines: readonly string[]): string {
  const blocks: Block[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ kind: "text", text: "" }); // paragraph break marker
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (RULE_START.test(line)) blocks.push({ kind: "rule", text: line });
    else if (BULLET.test(line))
      blocks.push({
        kind: "bullet",
        text: line.replace(/^[•–*-]\s+/, ""),
      });
    else if (last && last.text !== "") last.text = `${last.text} ${line}`;
    else blocks.push({ kind: "text", text: line });
  }
  const out: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length > 0) out.push(bullets.map((b) => `- ${b}`).join("\n"));
    bullets = [];
  };
  for (const b of blocks) {
    if (b.kind === "bullet") {
      bullets.push(b.text);
      continue;
    }
    flush();
    if (b.text !== "") out.push(b.text);
  }
  flush();
  return out.join("\n\n");
}

export function splitRulebook(input: string): ImportSplit {
  const lines = input
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n")
    .split("\n")
    .filter((l) => !PAGE_NUMBER.test(l));
  const strong = lines.some((l) => strongHeading(l) !== null);
  const headingOf = (l: string) =>
    strong ? strongHeading(l) : numberedHeading(l);

  const raw: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const intro: string[] = [];
  for (const line of lines) {
    const heading = headingOf(line);
    if (heading) {
      current = { title: heading, lines: [] };
      raw.push(current);
    } else if (current) current.lines.push(line);
    else intro.push(line);
  }
  const warnings: string[] = [];
  if (raw.length === 0) {
    const body = bodyOf(intro);
    if (!body) return { sections: [], warnings: ["No text to split."] };
    warnings.push(
      "No section headings found, so everything is one section. Rename it, or put each heading on its own line, such as “1. Pitching”.",
    );
    return {
      sections: capped([{ title: "Rulebook", body }], warnings),
      warnings,
    };
  }
  const sections: ImportedSection[] = [];
  const introBody = bodyOf(intro);
  if (introBody) sections.push({ title: "Introduction", body: introBody });
  for (const r of raw) {
    const body = bodyOf(r.lines);
    if (!body) {
      warnings.push(`“${r.title}” has no text under it, so it was left out.`);
      continue;
    }
    sections.push({ title: r.title, body });
  }
  return { sections: capped(sections, warnings), warnings };
}

/** Titles and bodies within the limits, titles unique; warns about each fix. */
function capped(
  sections: ImportedSection[],
  warnings: string[],
): ImportedSection[] {
  const seen = new Set<string>();
  return sections.map((s) => {
    let title = s.title;
    if (title.length > TITLE_MAX) {
      title = `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;
      warnings.push(`A long heading was shortened to “${title}”.`);
    }
    const base = title;
    for (let n = 2; seen.has(title.toLowerCase()); n++)
      title = `${base.slice(0, TITLE_MAX - 4)} (${n})`;
    seen.add(title.toLowerCase());
    if (s.body.length > BODY_MAX)
      warnings.push(
        `“${title}” is over ${BODY_MAX.toLocaleString("en-US")} characters. Split it into two sections before saving.`,
      );
    return { title, body: s.body };
  });
}

export type ImportError = "empty" | "too_big";

/** The text an owner pasted, or why it can't be split. */
export function checkImportText(input: string): Result<string, ImportError> {
  if (!input.trim()) return err("empty");
  if (input.length > IMPORT_MAX) return err("too_big");
  return ok(input);
}

/**
 * The editor submission that makes the league's rules the imported ones: a
 * section whose title matches a current one edits it (so its anchor and
 * links survive), a new title adds one, and a current section the import
 * doesn't have is removed. The change log records each.
 */
export function planImport(
  current: readonly CurrentSection[],
  imported: readonly ImportedSection[],
): SubmittedSection[] {
  const byTitle = new Map(
    current.map((c) => [c.title.trim().toLowerCase(), c]),
  );
  const used = new Set<string>();
  const submitted: SubmittedSection[] = imported.map((s) => {
    const match = byTitle.get(s.title.trim().toLowerCase());
    if (match && !used.has(match.id)) {
      used.add(match.id);
      return { id: match.id, title: s.title, body: s.body, remove: false };
    }
    return { id: null, title: s.title, body: s.body, remove: false };
  });
  for (const c of current)
    if (!used.has(c.id))
      submitted.push({ id: c.id, title: c.title, body: c.body, remove: true });
  return submitted;
}
