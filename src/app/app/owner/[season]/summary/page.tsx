import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MoneySummaryView } from "@/components/money-summary";
import { PageLoading } from "@/components/page-loading";
import { CATEGORY_LABELS } from "@/domain/books/ledger";
import { MIN_MEMBERS_TO_PUBLISH } from "@/domain/dashboard/money";
import { requirePermission } from "@/lib/auth/permission";
import { publishSummaryAction, unpublishSummaryAction } from "../../actions";
import { FOLDABLE, foldedFrom, liveSummary, ownerSeason } from "../../load";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Money summary" };

export default function SummaryPage(
  props: PageProps<"/app/owner/[season]/summary">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the summary…</PageLoading>}>
        <Summary {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  too_few_members: `A season needs at least ${MIN_MEMBERS_TO_PUBLISH} members before its summary can go public, so no total stands for one person's payment.`,
  no_money: "There's no money in or out to show yet.",
  not_published: "That summary wasn't published.",
};

const NOTICES: Record<string, string> = {
  published: "Published. Anyone can see the summary now.",
  unpublished: "Taken down. The summary is private again.",
};

const date = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(d);

async function Summary({
  params,
  searchParams,
}: PageProps<"/app/owner/[season]/summary">) {
  const { season: slug } = await params;
  const page = `/app/owner/${slug}/summary`;
  await requirePermission("money_summary.publish", { next: page });
  const query = await searchParams;
  const { league, season } = await ownerSeason(slug);
  const asked = query.fold;
  // The first visit starts from what is published, if anything.
  const fresh = asked === undefined && query.preview === undefined;
  const preview = await liveSummary(
    league.id,
    season,
    fresh ? "as_published" : foldedFrom(Array.isArray(asked) ? asked : [asked]),
  );
  const { folded, published } = preview;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const publicPath = `/seasons/${season.slug}/money`;
  const spent = new Set(
    preview.money.expenses.filter((e) => e.cents > 0).map((e) => e.category),
  );

  return (
    <>
      <header className="flex flex-col gap-3">
        <p className="text-text-muted">
          <Link href={`/app/owner/${season.slug}`} className="underline">
            Owner dashboard
          </Link>{" "}
          · {season.name}
        </p>
        <h1 className="text-h1">Money summary</h1>
        <p>
          An optional public page that shows members where the season&apos;s
          money goes: category totals and how each fee divides across them. It
          never shows anyone&apos;s name, payment, birth date or contact
          details. It&apos;s off until you publish it, and what you see below is
          exactly what goes public.
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
        <p className="rounded-lg border border-border bg-surface p-3">
          {published ? (
            <>
              Published {date(published.publishedAt, league.timeZone)}.{" "}
              <Link href={publicPath} className="underline">
                See the public page
              </Link>
              . It keeps those numbers until you publish again.
            </>
          ) : (
            <>Not published. Only owners can see this preview.</>
          )}
        </p>
      </header>

      <form method="get" className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-h3">Show inside &ldquo;Other&rdquo;</legend>
          <p className="text-small text-text-muted">
            Fold a category into Other when its total would point at one person,
            such as one referee who worked every game.
          </p>
          <input type="hidden" name="preview" value="1" />
          {FOLDABLE.filter((c) => spent.has(c) || folded.includes(c)).map(
            (c) => (
              <label key={c} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="fold"
                  value={c}
                  defaultChecked={folded.includes(c)}
                  className="size-5"
                />
                {CATEGORY_LABELS[c]}
              </label>
            ),
          )}
        </fieldset>
        <SubmitButton className="btn self-start btn-secondary">
          Update the preview
        </SubmitButton>
      </form>

      <section
        aria-labelledby="preview"
        className="flex flex-col gap-4 rounded-card border-2 border-dashed border-border-strong p-4"
      >
        <h2 id="preview" className="text-h2">
          Preview: {season.name}
        </h2>
        <MoneySummaryView summary={preview.summary} headingLevel={3} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <form action={publishSummaryAction.bind(null, season.slug)}>
          {folded.map((c) => (
            <input key={c} type="hidden" name="fold" value={c} />
          ))}
          <SubmitButton
            className="btn btn-primary"
            disabled={preview.blocker !== null}
          >
            {published ? "Publish these numbers" : "Publish the summary"}
          </SubmitButton>
        </form>
        {published && (
          <form action={unpublishSummaryAction.bind(null, season.slug)}>
            <SubmitButton className="btn btn-secondary">
              Take it down
            </SubmitButton>
          </form>
        )}
      </div>
      {preview.blocker && (
        <p className="text-text-muted">{ERRORS[preview.blocker]}</p>
      )}
    </>
  );
}
