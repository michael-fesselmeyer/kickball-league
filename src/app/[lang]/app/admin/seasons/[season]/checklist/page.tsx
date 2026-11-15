import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  DueField,
  NotesField,
  OwnerField,
  TitleField,
} from "@/components/checklist";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import {
  checklistStaff,
  seasonChecklist,
  type StaffMember,
  type TaskRow,
} from "@/db/queries/checklist";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { can } from "@/domain/authz/permissions";
import { localDate } from "@/domain/books/ledger-csv";
import {
  CHECKLIST_FORM_ERRORS,
  type ChecklistFormError,
  dueLabel,
} from "@/domain/checklist/tasks";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import {
  addTaskAction,
  deleteTaskAction,
  setDoneAction,
  startChecklistAction,
  updateTaskAction,
} from "./actions";

export const metadata: Metadata = { title: "Season checklist" };

export default function ChecklistPage(
  props: PageProps<"/[lang]/app/admin/seasons/[season]/checklist">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Checklist {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<ChecklistFormError | "not_found", string> = {
  ...CHECKLIST_FORM_ERRORS,
  not_found: "That task was removed. Here is the list as it stands.",
};

const NOTICES: Record<string, string> = {
  added: "Added the task.",
  saved: "Saved the task.",
  done: "Ticked off. Nice work.",
  reopened: "Opened the task again.",
  removed: "Removed the task.",
};

const shortDate = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

async function Checklist({
  params,
  searchParams,
}: PageProps<"/[lang]/app/admin/seasons/[season]/checklist">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const subject = await requirePermission("checklist.manage", {
    next: `/app/admin/seasons/${slug}/checklist`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const [tasks, staff] = await Promise.all([
    seasonChecklist(db, season.id),
    checklistStaff(db, season.leagueId),
  ]);
  const today = localDate(new Date(), season.timeZone);
  const open = tasks.filter((t) => !t.doneAt);
  const done = tasks.filter((t) => t.doneAt);
  const error =
    typeof query.error === "string" && Object.hasOwn(ERRORS, query.error)
      ? ERRORS[query.error as keyof typeof ERRORS]
      : undefined;
  const added =
    typeof query.added === "string" ? Number(query.added) : undefined;
  const notice =
    added !== undefined
      ? added === 0
        ? "The checklist already has every template task."
        : `Added ${added} ${added === 1 ? "task" : "tasks"} from the template.`
      : typeof query.notice === "string" && Object.hasOwn(NOTICES, query.notice)
        ? NOTICES[query.notice]
        : undefined;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}`} className="underline">
          ← {season.name}
        </Link>
        <h1 className="text-h1">Season checklist</h1>
        <p className="text-text-muted">
          The jobs that keep {season.name} running, for owners and admins. Each
          task&apos;s owner gets an email reminder 3 days before it&apos;s due
          and once if it&apos;s overdue. A task with no owner reminds the
          league&apos;s owners.
        </p>
        {can(subject, "checklist.template") && (
          <Link href="/app/admin/checklist-template" className="underline">
            Edit the template every season starts from
          </Link>
        )}
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}

      <section aria-labelledby="to-do" className="flex flex-col gap-3">
        <h2 id="to-do" className="text-h2">
          To do
        </h2>
        {open.length === 0 && (
          <p className="text-text-muted">
            {tasks.length === 0
              ? "No tasks yet. Start from the league's template, or add your own below."
              : "Everything is done."}
          </p>
        )}
        {open.length > 0 && (
          <ul className="flex flex-col gap-4">
            {open.map((t) => (
              <OpenTask
                key={t.id}
                task={t}
                slug={slug}
                today={today}
                staff={staff}
              />
            ))}
          </ul>
        )}
        <form action={startChecklistAction.bind(null, slug)}>
          <SubmitButton
            className={`btn ${tasks.length === 0 ? "btn-primary" : "btn-secondary"}`}
          >
            {tasks.length === 0
              ? "Start from the template"
              : "Add new tasks from the template"}
          </SubmitButton>
        </form>
      </section>

      <section aria-labelledby="add" className="flex flex-col gap-3">
        <h2 id="add" className="text-h2">
          Add a task
        </h2>
        <form
          action={addTaskAction.bind(null, slug)}
          className="flex flex-col gap-3"
        >
          <TitleField />
          <DueField />
          <OwnerField staff={staff} />
          <NotesField />
          <SubmitButton className="btn self-start btn-primary">
            Add the task
          </SubmitButton>
        </form>
      </section>

      {done.length > 0 && (
        <section aria-labelledby="done" className="flex flex-col gap-3">
          <h2 id="done" className="text-h2">
            Done
          </h2>
          <ul className="flex flex-col">
            {done.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
              >
                <span>
                  <span className="line-through">{t.title}</span>
                  {t.ownerName && (
                    <span className="text-small text-text-muted">
                      {" "}
                      · {t.ownerName}
                    </span>
                  )}
                </span>
                <form action={setDoneAction.bind(null, slug, t.id, false)}>
                  <SubmitButton className="btn btn-secondary">
                    Open again<span className="sr-only">: {t.title}</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function OpenTask({
  task,
  slug,
  today,
  staff,
}: {
  task: TaskRow;
  slug: string;
  today: string;
  staff: readonly StaffMember[];
}) {
  const label = dueLabel(task.dueOn, today);
  const late = task.dueOn < today;
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
      <p className="font-bold">{task.title}</p>
      <p className="text-small">
        <span className={late ? "font-bold text-danger" : undefined}>
          {label}
        </span>
        <span className="text-text-muted">
          {" "}
          · {shortDate(task.dueOn)} · {task.ownerName ?? "Nobody yet"}
        </span>
      </p>
      {task.notes && <p className="whitespace-pre-line">{task.notes}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <form action={setDoneAction.bind(null, slug, task.id, true)}>
          <SubmitButton className="btn btn-primary">
            Mark done<span className="sr-only">: {task.title}</span>
          </SubmitButton>
        </form>
        <form action={deleteTaskAction.bind(null, slug, task.id)}>
          <SubmitButton className="btn btn-secondary">
            Remove<span className="sr-only">: {task.title}</span>
          </SubmitButton>
        </form>
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 underline">
          Edit<span className="sr-only">: {task.title}</span>
        </summary>
        <form
          action={updateTaskAction.bind(null, slug, task.id)}
          className="flex flex-col gap-3 pt-2"
        >
          <TitleField value={task.title} />
          <DueField value={task.dueOn} />
          <OwnerField staff={staff} value={task.ownerId} />
          <NotesField value={task.notes} />
          <SubmitButton className="btn self-start btn-primary">
            Save changes
          </SubmitButton>
        </form>
      </details>
    </li>
  );
}
