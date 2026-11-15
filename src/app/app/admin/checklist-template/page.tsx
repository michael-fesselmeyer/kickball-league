import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  NotesField,
  OffsetField,
  OwnerField,
  TitleField,
} from "@/components/checklist";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db, txDb } from "@/db/client";
import {
  checklistStaff,
  ensureTemplate,
  templateTasks,
} from "@/db/queries/checklist";
import {
  CHECKLIST_FORM_ERRORS,
  type ChecklistFormError,
  offsetLabel,
} from "@/domain/checklist/tasks";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import {
  addTemplateTaskAction,
  deleteTemplateTaskAction,
  updateTemplateTaskAction,
} from "./actions";

export const metadata: Metadata = { title: "Checklist template" };

export default function ChecklistTemplatePage(
  props: PageProps<"/app/admin/checklist-template">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Template {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<ChecklistFormError | "not_found", string> = {
  ...CHECKLIST_FORM_ERRORS,
  not_found: "That task was removed. Here is the template as it stands.",
};

const NOTICES: Record<string, string> = {
  added: "Added the task to the template.",
  saved: "Saved the template task.",
  removed: "Removed the task from the template.",
};

const pick = <T,>(table: Record<string, T>, key: unknown): T | undefined =>
  typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;

async function Template({
  searchParams,
}: PageProps<"/app/admin/checklist-template">) {
  const query = await searchParams;
  await requirePermission("checklist.template", {
    next: "/app/admin/checklist-template",
  });
  const league = await activeLeague();
  if (!league) notFound();
  // A league with no template gets the starter tasks (ADR 0061).
  await txDb.transaction((tx) => ensureTemplate(tx, league.id));
  const [tasks, staff] = await Promise.all([
    templateTasks(db, league.id),
    checklistStaff(db, league.id),
  ]);
  const error = pick(ERRORS, query.error);
  const notice = pick(NOTICES, query.notice);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/app/admin" className="underline">
          ← League admin
        </Link>
        <h1 className="text-h1">Checklist template</h1>
        <p className="text-text-muted">
          The tasks every season&apos;s checklist starts with, each due a number
          of days before or after the season&apos;s first day. Changes here
          don&apos;t touch seasons already started; use &ldquo;Add new tasks
          from the template&rdquo; on a season&apos;s checklist to bring in new
          ones. Remove every task and the starter tasks come back.
        </p>
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

      <section aria-labelledby="tasks" className="flex flex-col gap-3">
        <h2 id="tasks" className="text-h2">
          Tasks
        </h2>
        <ul className="flex flex-col gap-4">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
            >
              <p className="font-bold">{t.title}</p>
              <p className="text-small text-text-muted">
                {offsetLabel(t.offsetDays)} · {t.ownerName ?? "Nobody yet"}
              </p>
              {t.notes && <p className="whitespace-pre-line">{t.notes}</p>}
              <details>
                <summary className="min-h-11 cursor-pointer py-2 underline">
                  Edit<span className="sr-only">: {t.title}</span>
                </summary>
                <form
                  action={updateTemplateTaskAction.bind(null, t.id)}
                  className="flex flex-col gap-3 pt-2"
                >
                  <TitleField value={t.title} />
                  <OffsetField value={t.offsetDays} />
                  <OwnerField staff={staff} value={t.ownerId} />
                  <NotesField value={t.notes} />
                  <SubmitButton className="btn self-start btn-primary">
                    Save changes
                  </SubmitButton>
                </form>
              </details>
              <form action={deleteTemplateTaskAction.bind(null, t.id)}>
                <SubmitButton className="btn btn-secondary">
                  Remove<span className="sr-only">: {t.title}</span>
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="add" className="flex flex-col gap-3">
        <h2 id="add" className="text-h2">
          Add a task
        </h2>
        <form action={addTemplateTaskAction} className="flex flex-col gap-3">
          <TitleField />
          <OffsetField />
          <OwnerField staff={staff} />
          <NotesField />
          <SubmitButton className="btn self-start btn-primary">
            Add to the template
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
