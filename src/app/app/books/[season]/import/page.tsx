import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { merchantRules } from "@/db/queries/books-upkeep";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES } from "@/domain/books/ledger";
import { PATTERN_MAX } from "@/domain/books/statement";
import { requirePermission } from "@/lib/auth/permission";
import { booksSeason } from "../../load";
import {
  importRowsAction,
  previewImportAction,
  removeRuleAction,
  saveRuleAction,
} from "./actions";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import a statement" };

export default function ImportPage(
  props: PageProps<"/app/books/[season]/import">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Import {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  pattern: `Enter 2 to ${PATTERN_MAX} letters from the description, such as "parks".`,
  category: "Pick a category.",
  unknown_rule: "That rule is already gone.",
  unknown_season: "That season isn't in this league.",
};

const NOTICES: Record<string, string> = {
  rule_saved: "Rule saved. Preview the statement again to use it.",
  rule_removed: "Rule removed.",
};

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

async function Import({
  params,
  searchParams,
}: PageProps<"/app/books/[season]/import">) {
  const { season: slug } = await params;
  const page = `/app/books/${slug}/import`;
  await requirePermission("books.manage", { next: page });
  const query = await searchParams;
  const { league, season } = await booksSeason(slug);
  const rules = await merchantRules(db, league.id);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/books/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Books: {season.name}
        </Link>
        <h1 className="text-h1">Import a statement</h1>
        <p className="text-text-muted">
          Download a CSV from Venmo (Statements, then Download CSV) or from your
          bank&apos;s transaction history, and pick it here. The money-out rows
          are listed with a guessed category for you to check before anything is
          added. Rows already in the books are skipped.
        </p>
      </header>

      <ImportForm
        preview={previewImportAction.bind(null, slug)}
        importRows={importRowsAction.bind(null, slug)}
        seasonName={season.name}
      />

      <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
        <h2 id="rules-heading" className="text-h2">
          Category rules
        </h2>
        <p className="text-text-muted">
          When a description contains these words, the preview guesses this
          category. Your rules come before the built-in ones, and the longest
          match wins.
        </p>
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
        {rules.length > 0 && (
          <ul className="flex flex-col">
            {rules.map((r) => (
              <li
                key={r.pattern}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
              >
                <span>
                  &ldquo;{r.pattern}&rdquo; → {CATEGORY_LABELS[r.category]}
                </span>
                <form action={removeRuleAction.bind(null, slug)}>
                  <input type="hidden" name="pattern" value={r.pattern} />
                  <SubmitButton className="btn btn-secondary">
                    Remove<span className="sr-only"> rule {r.pattern}</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form
          action={saveRuleAction.bind(null, slug)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-small">Description contains</span>
            <input
              name="pattern"
              required
              minLength={2}
              maxLength={PATTERN_MAX}
              autoComplete="off"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small">Category for the rule</span>
            <select name="category" required className={input}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton className="btn btn-secondary">Save rule</SubmitButton>
        </form>
      </section>
    </>
  );
}
