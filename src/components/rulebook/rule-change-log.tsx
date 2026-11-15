import type { LogEntry, SectionRow } from "@/db/queries/rules";
import { localDate } from "@/domain/books/ledger-csv";
import { dayLabel } from "./rulebook-sections";

const KIND_WORDS = {
  added: "added",
  edited: "changed",
  removed: "removed",
} as const;

/** The dated "What changed" list under the rules (ADR 0062). */
export function RuleChangeLog({
  changes,
  sections,
  today,
  timeZone,
}: {
  changes: readonly LogEntry[];
  sections: readonly SectionRow[];
  today: string;
  timeZone: string;
}) {
  const live = new Set(sections.map((s) => s.slug));
  const publishedOn = (at: Date) => localDate(at, timeZone);
  return (
    <section
      id="changes"
      aria-labelledby="changes-title"
      className="flex flex-col gap-3"
    >
      <h2 id="changes-title" className="text-h2">
        What changed
      </h2>
      {changes.length === 0 ? (
        <p className="text-text-muted">No changes yet.</p>
      ) : (
        <ol className="flex flex-col">
          {changes.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-1 border-t border-border py-3"
            >
              <p className="text-small text-text-muted">
                <time dateTime={c.createdAt.toISOString()}>
                  {dayLabel(publishedOn(c.createdAt))}
                </time>
                {c.effectiveOn !== publishedOn(c.createdAt) && (
                  <>
                    {" · "}
                    {c.effectiveOn > today ? "Starts" : "Started"}{" "}
                    {dayLabel(c.effectiveOn)}
                  </>
                )}
              </p>
              <p className="font-bold">{c.summary}</p>
              <p className="text-small">
                {c.sections.map((s, i) => (
                  <span key={`${s.slug}-${s.kind}`}>
                    {i > 0 && ", "}
                    {live.has(s.slug) && s.kind !== "removed" ? (
                      <a href={`#${s.slug}`} className="underline">
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}{" "}
                    {KIND_WORDS[s.kind]}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Section slug to the day its newest not-yet-started wording takes effect. */
export function upcomingWording(
  changes: readonly LogEntry[],
  today: string,
): Map<string, string> {
  const upcoming = new Map<string, string>();
  for (const c of [...changes].reverse())
    for (const s of c.sections)
      if (c.effectiveOn > today && s.kind !== "removed")
        upcoming.set(s.slug, c.effectiveOn);
  return upcoming;
}
