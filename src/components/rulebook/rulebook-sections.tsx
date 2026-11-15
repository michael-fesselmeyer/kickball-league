import type { SectionRow } from "@/db/queries/rules";
import { numberedBlocksOf } from "@/domain/rules/rulebook";

export const dayLabel = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

/**
 * The rulebook's table of contents and sections (ADR 0066). Each section has
 * an anchor from its slug and each numbered rule its own, so a link or a
 * search result can land on one rule. Plain server markup: no client
 * JavaScript, so it can sit in a static page.
 */
export function RulebookSections({
  sections,
  upcoming,
  today,
}: {
  sections: readonly SectionRow[];
  /** Section slug to the day its new wording starts. */
  upcoming: ReadonlyMap<string, string>;
  today: string;
}) {
  if (sections.length === 0)
    return (
      <p className="rounded-card border border-border bg-surface p-4 text-text-muted">
        The league hasn&apos;t posted its rules here yet. Ask your captain for
        now.
      </p>
    );
  return (
    <>
      {sections.length > 1 && (
        <nav aria-label="Contents" className="flex flex-col gap-2">
          <h2 className="text-h3">Contents</h2>
          <ol className="flex flex-col">
            {sections.map((s, i) => (
              <li key={s.id} className="border-t border-border">
                <a
                  href={`#${s.slug}`}
                  className="flex min-h-11 items-center gap-3 underline"
                >
                  <span className="w-6 text-text-muted">{i + 1}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {sections.map((s, i) => (
        <section
          key={s.id}
          id={s.slug}
          data-rule-section
          aria-labelledby={`${s.slug}-title`}
          className="flex scroll-mt-20 flex-col gap-3"
        >
          <h2 id={`${s.slug}-title`} className="text-h2">
            <span className="mr-2 text-text-muted">{i + 1}</span>
            {s.title}
          </h2>
          {upcoming.has(s.slug) && (
            <p className="self-start rounded-full border border-warning px-3 py-1 text-small font-bold">
              New wording from {dayLabel(upcoming.get(s.slug) ?? today)}
            </p>
          )}
          {numberedBlocksOf(s.slug, s.body).map((b, j) => {
            if (b.kind === "list")
              return (
                <ul key={j} className="flex list-disc flex-col gap-1 pl-6">
                  {b.items.map((item, k) => (
                    <li key={k}>{item}</li>
                  ))}
                </ul>
              );
            if (b.kind === "rule")
              return (
                <p
                  key={j}
                  id={b.anchor}
                  className="flex max-w-prose scroll-mt-20 gap-3 rounded-input py-1 target:outline target:outline-2 target:outline-offset-4 target:outline-brand"
                >
                  <a
                    href={`#${b.anchor}`}
                    aria-label={`Rule ${b.number}`}
                    className="min-w-10 shrink-0 font-bold text-brand underline"
                  >
                    {b.number}
                  </a>
                  <span className="whitespace-pre-line">{b.text}</span>
                </p>
              );
            return (
              <p key={j} className="max-w-prose whitespace-pre-line">
                {b.text}
              </p>
            );
          })}
        </section>
      ))}
    </>
  );
}
