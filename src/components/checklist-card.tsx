import Link from "next/link";
import type { TaskRow } from "@/db/queries/checklist";
import { dueLabel } from "@/domain/checklist/tasks";

/**
 * The admin dashboard's card: the season checklist's next three open
 * tasks (ADR 0053), soonest first, with who has each one.
 */
export function ChecklistCard({
  tasks,
  today,
  href,
}: {
  tasks: readonly TaskRow[];
  today: string;
  href: string;
}) {
  return (
    <section
      aria-labelledby="checklist"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <h2 id="checklist" className="text-h3">
        Next on the checklist
      </h2>
      {tasks.length === 0 ? (
        <p className="text-text-muted">
          Nothing open on this season&apos;s checklist.
        </p>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-0.5 border-t border-border py-2 first:border-t-0 first:pt-0"
            >
              <span className="font-bold">{t.title}</span>
              <span className="text-small text-text-muted">
                <span
                  className={
                    t.dueOn < today ? "font-bold text-danger" : undefined
                  }
                >
                  {dueLabel(t.dueOn, today)}
                </span>{" "}
                · {t.ownerName ?? "Nobody yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href={href} className="underline">
        Open the checklist
      </Link>
    </section>
  );
}
