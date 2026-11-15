import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { AwardsBoardView } from "@/components/stat-awards";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { activeLeagueId } from "@/lib/league/active";
import { awardsBoard } from "@/db/queries/stat-awards";
import {
  DEFAULT_MVP_WEIGHTS,
  MVP_PART_LABELS,
  MVP_PARTS,
  NOTE_MAX,
  STAT_AWARD_KEYS,
  STAT_AWARDS,
  WEIGHT_MAX,
} from "@/domain/awards/stat-awards";
import { requirePermission } from "@/lib/auth/permission";
import { requireFeature } from "@/lib/platform/site";
import {
  computeStatAwardsAction,
  publishAction,
  saveNoteAction,
} from "./actions";

export const metadata: Metadata = { title: "Stat awards" };

export default function StatAwardsAdminPage(
  props: PageProps<"/[lang]/app/admin/seasons/[season]/awards/stats">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <StatAwards {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const ERRORS: Record<string, string> = {
  bad_weight: `Each weight is a whole number from 0 to ${WEIGHT_MAX}.`,
  all_zero: "Give at least one part a weight above 0.",
  published:
    "These awards are published. Take them down before working them out again.",
  not_computed: "Work the awards out first.",
  note_too_long: `Keep a note under ${NOTE_MAX} characters.`,
};

const NOTICES: Record<string, string> = {
  computed: "Awards worked out. Check them below, then publish.",
  noted: "Note saved.",
  published: "Published. The awards page is live.",
  unpublished: "Taken down. The awards page is hidden again.",
};

const field = "rounded-md border border-border bg-surface px-2 py-2";

async function StatAwards({
  params,
  searchParams,
}: PageProps<"/[lang]/app/admin/seasons/[season]/awards/stats">) {
  await requireFeature("awards");
  const { season: slug } = await params;
  const query = await searchParams;
  await requirePermission("awards.manage", {
    next: `/app/admin/seasons/${slug}/awards/stats`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const found = await awardsBoard(
    db,
    { seasonId: season.id },
    { publishedOnly: false },
  );
  const board = found.found ? found.board : null;
  const weights = board?.weights ?? DEFAULT_MVP_WEIGHTS;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: season.timeZone,
    }).format(d);

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={`/app/admin/seasons/${slug}/awards`} className="underline">
          {season.name} awards
        </Link>
        <h1 className="text-h1">Stat awards</h1>
        <p className="text-text-muted">
          Winners worked out from what the app recorded: kicking orders, RSVPs,
          bar check-ins, live scores, sportsmanship ratings, sub spots and
          closed polls. Players who opted out of leaderboards are left out.
          Review them, add a note if you like, then publish.
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

      <section aria-labelledby="compute" className="flex flex-col gap-3">
        <h2 id="compute" className="text-h2">
          Season MVP weights
        </h2>
        <p>
          How much each part counts toward the MVP score (0 to {WEIGHT_MAX}).
          The weights are printed on the awards page.
        </p>
        <form
          action={computeStatAwardsAction.bind(null, slug)}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {MVP_PARTS.map((part) => (
              <label key={part} className="flex flex-col gap-1">
                {MVP_PART_LABELS[part]}
                <input
                  type="number"
                  name={part}
                  min={0}
                  max={WEIGHT_MAX}
                  step={1}
                  required
                  inputMode="numeric"
                  defaultValue={weights[part]}
                  className={field}
                  disabled={Boolean(board?.publishedAt)}
                />
              </label>
            ))}
          </div>
          <SubmitButton
            className="btn self-start btn-primary"
            disabled={Boolean(board?.publishedAt)}
          >
            {board ? "Work them out again" : "Work out the awards"}
          </SubmitButton>
        </form>
      </section>

      {board && (
        <>
          <section aria-labelledby="publish" className="flex flex-col gap-3">
            <h2 id="publish" className="text-h2">
              {board.publishedAt ? "Published" : "Draft"}
            </h2>
            <p className="text-text-muted">
              Worked out {when(board.computedAt)}
              {board.publishedAt
                ? `, published ${when(board.publishedAt)}.`
                : ". Only admins see it until you publish."}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <form action={publishAction.bind(null, slug, !board.publishedAt)}>
                <SubmitButton
                  className={`btn ${board.publishedAt ? "btn-secondary" : "btn-primary"}`}
                >
                  {board.publishedAt ? "Take down" : "Publish"}
                </SubmitButton>
              </form>
              {board.publishedAt && (
                // Not prefetched: a prefetch renders the public page while
                // the admin may be taking it down, and a render that ends
                // after the take-down is cached as fresh, so the page stays
                // up (public-cache.ts, SECOND_EXPIRY_MS).
                <Link
                  href={`/seasons/${slug}/awards`}
                  prefetch={false}
                  className="underline"
                >
                  See the awards page
                </Link>
              )}
            </div>
          </section>
          <section aria-labelledby="notes" className="flex flex-col gap-3">
            <h2 id="notes" className="text-h2">
              Notes
            </h2>
            <p>A note shows under its award, such as why a tie stood.</p>
            {STAT_AWARD_KEYS.map((award) => (
              <form
                key={award}
                action={saveNoteAction.bind(null, slug, award)}
                className="flex flex-col gap-1"
              >
                <label htmlFor={`note-${award}`}>
                  Note on {STAT_AWARDS[award].label}
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id={`note-${award}`}
                    name="note"
                    maxLength={NOTE_MAX}
                    defaultValue={board.notes[award] ?? ""}
                    className={`${field} min-w-0 flex-1`}
                  />
                  <SubmitButton className="btn btn-secondary">
                    Save note
                  </SubmitButton>
                </div>
              </form>
            ))}
          </section>
          <AwardsBoardView board={board} />
        </>
      )}
    </>
  );
}
