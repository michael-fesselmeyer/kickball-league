import { err, ok, type Result } from "@/domain/result";
import { addDays } from "@/domain/season/rollover";

/**
 * The league's rules page (ADR 0056): sections admins write in the app, and
 * a dated log of every change. Pure: the query layer reads and writes, this
 * decides what a submitted form changes and whether it may be published.
 */

export const TITLE_MAX = 80;
export const BODY_MAX = 20_000;
export const SUMMARY_MAX = 200;
/**
 * A change that players are told about must take effect at least this many
 * days after it is published, so the notice arrives in time.
 */
export const NOTICE_DAYS = 3;

/** Section titles the editor suggests; the text is always the league's own. */
export const SUGGESTED_SECTIONS = [
  "Lineups",
  "Fielding",
  "Pitching",
  "Kicking",
  "Running",
  "Scoring",
  "Playoffs",
] as const;

/** One section's part in a change, with the text before and after. */
export type SectionChange = {
  slug: string;
  kind: "added" | "edited" | "removed";
  title: string;
  titleBefore: string | null;
  before: string | null;
  after: string | null;
};

export type CurrentSection = {
  id: string;
  slug: string;
  title: string;
  body: string;
  position: number;
};

/** A section as the editor sends it: no id for a new one. */
export type SubmittedSection = {
  id: string | null;
  title: string;
  body: string;
  remove: boolean;
};

export type PlannedSection = {
  id: string | null;
  slug: string;
  title: string;
  body: string;
  position: number;
};

export type RulePlan = {
  /** Every section after the change, in order; new ones have no id. */
  sections: PlannedSection[];
  removeIds: string[];
  changes: SectionChange[];
};

export type RuleFormError =
  | "no_changes"
  | "empty_title"
  | "empty_body"
  | "too_long"
  | "duplicate_title"
  | "stale"
  | "empty_summary"
  | "bad_date"
  | "effective_in_past"
  | "notice_too_soon";

export const RULE_FORM_ERRORS: Record<RuleFormError, string> = {
  no_changes: "Nothing changed, so there's nothing to publish.",
  empty_title: "Give every section a title.",
  empty_body:
    "A section needs some text. To take a section out, tick its remove box.",
  too_long: `Keep titles under ${TITLE_MAX} characters and each section under ${BODY_MAX.toLocaleString("en-US")}.`,
  duplicate_title: "Two sections have the same title. Give each its own.",
  stale:
    "Someone published a change to the rules while you were editing. Your text is below; check it against the rules as they are now, then publish again.",
  empty_summary: `Say what changed in one line, up to ${SUMMARY_MAX} characters.`,
  bad_date: "Pick the day the change takes effect.",
  effective_in_past: "A change can't take effect before today.",
  notice_too_soon: `Players need ${NOTICE_DAYS} days' notice. Pick a later start date, or publish without a notice.`,
};

/** A URL fragment for a section title: "Lineups & subs" becomes "lineups-subs". */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "section";
}

/**
 * Works out what a submitted editor changes. Sections keep the slug they
 * were created with, so links to them survive a new title; a new section
 * gets a slug from its title that no other section uses. A blank new row
 * is ignored. A form naming a section that no longer exists is stale.
 */
export function planChange(
  current: readonly CurrentSection[],
  submitted: readonly SubmittedSection[],
): Result<RulePlan, RuleFormError> {
  const byId = new Map(current.map((s) => [s.id, s]));
  const seenIds = new Set<string>();
  const rows = submitted
    .map((s) => ({ ...s, title: s.title.trim(), body: s.body.trim() }))
    .filter((s) => s.id !== null || s.remove || s.title || s.body);
  for (const row of rows) {
    if (row.id === null) continue;
    if (!byId.has(row.id) || seenIds.has(row.id)) return err("stale");
    seenIds.add(row.id);
  }
  // A section missing from the form was removed by someone else, or the
  // form is not the whole list: either way, don't guess.
  if (seenIds.size !== current.length) return err("stale");

  const kept = rows.filter((r) => !(r.remove && r.id !== null));
  const titles = new Set<string>();
  for (const row of kept) {
    if (row.remove) continue; // a new row ticked for removal: ignore it
    if (!row.title) return err("empty_title");
    if (!row.body) return err("empty_body");
    if (row.title.length > TITLE_MAX || row.body.length > BODY_MAX)
      return err("too_long");
    const key = row.title.toLowerCase();
    if (titles.has(key)) return err("duplicate_title");
    titles.add(key);
  }

  const usedSlugs = new Set(
    kept.flatMap((r) => (r.id !== null ? [byId.get(r.id)?.slug ?? ""] : [])),
  );
  const sections: PlannedSection[] = [];
  const changes: SectionChange[] = [];
  for (const row of kept) {
    if (row.remove) continue;
    const position = sections.length;
    if (row.id === null) {
      const base = slugify(row.title);
      let slug = base;
      for (let n = 2; usedSlugs.has(slug); n++) slug = `${base}-${n}`;
      usedSlugs.add(slug);
      sections.push({
        id: null,
        slug,
        title: row.title,
        body: row.body,
        position,
      });
      changes.push({
        slug,
        kind: "added",
        title: row.title,
        titleBefore: null,
        before: null,
        after: row.body,
      });
      continue;
    }
    const was = byId.get(row.id);
    if (!was) return err("stale");
    sections.push({
      id: row.id,
      slug: was.slug,
      title: row.title,
      body: row.body,
      position,
    });
    if (was.title !== row.title || was.body !== row.body)
      changes.push({
        slug: was.slug,
        kind: "edited",
        title: row.title,
        titleBefore: was.title === row.title ? null : was.title,
        before: was.body,
        after: row.body,
      });
  }
  const removeIds: string[] = [];
  for (const row of rows) {
    if (!row.remove || row.id === null) continue;
    const was = byId.get(row.id);
    if (!was) return err("stale");
    removeIds.push(row.id);
    changes.push({
      slug: was.slug,
      kind: "removed",
      title: was.title,
      titleBefore: null,
      before: was.body,
      after: null,
    });
  }
  if (changes.length === 0) return err("no_changes");
  return ok({ sections, removeIds, changes });
}

export type PublishInput = {
  summary: string;
  effectiveOn: string;
  notice: boolean;
};

/**
 * The change's one-line summary and start date. It can't start before
 * today, and one with a notice starts at least NOTICE_DAYS after today, in
 * the league's time zone.
 */
export function checkPublish(
  values: { summary: string; effectiveOn: string; notice: boolean },
  today: string,
): Result<PublishInput, RuleFormError> {
  const summary = values.summary.trim().replace(/\s+/g, " ");
  if (!summary || summary.length > SUMMARY_MAX) return err("empty_summary");
  const on = values.effectiveOn.trim() || today;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(on) ||
    Number.isNaN(Date.parse(`${on}T12:00:00Z`)) ||
    new Date(`${on}T12:00:00Z`).toISOString().slice(0, 10) !== on
  )
    return err("bad_date");
  if (on < today) return err("effective_in_past");
  if (values.notice && on < earliestWithNotice(today))
    return err("notice_too_soon");
  return ok({ summary, effectiveOn: on, notice: values.notice });
}

/** The first day a change with a notice may take effect. */
export function earliestWithNotice(today: string): string {
  return addDays(today, NOTICE_DAYS);
}

export type Block =
  { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

/**
 * A section's text as the page shows it: paragraphs split by a blank line,
 * and a run of lines that each start with "- " or "* " as a list. Plain
 * text only; nothing an admin types is read as HTML.
 */
export function blocksOf(body: string): Block[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): Block => {
      const lines = chunk.split("\n").map((l) => l.trim());
      return lines.every((l) => /^[-*]\s+/.test(l))
        ? { kind: "list", items: lines.map((l) => l.replace(/^[-*]\s+/, "")) }
        : { kind: "paragraph", text: lines.join("\n") };
    });
}
