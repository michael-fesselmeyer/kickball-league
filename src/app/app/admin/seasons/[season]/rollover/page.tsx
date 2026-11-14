import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { rolloverPlan, rolloverSource, slugInUse } from "@/db/queries/rollover";
import { currentLeague } from "@/db/queries/seasons";
import { formatCents } from "@/domain/registration/pricing";
import { fullWhen } from "@/domain/schedule/format";
import {
  playedTheSeason,
  type RolloverProblem,
  suggestedName,
  suggestedStart,
  daysBetween,
} from "@/domain/season/rollover";
import { requirePermission } from "@/lib/auth/permission";
import { rollOverAction } from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Start the next season" };

export default function RolloverPage(
  props: PageProps<"/app/admin/seasons/[season]/rollover">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Rollover {...props} />
      </Suspense>
    </main>
  );
}

const PROBLEMS: Record<
  RolloverProblem | "duplicate" | "unknown_season",
  string
> = {
  name: "Give the new season a name of up to 60 characters.",
  date: "Pick the day the new season starts.",
  same_dates: "Pick a start day other than this season's.",
  duplicate: "Another season already has that name. Pick another.",
  unknown_season: "That season is gone.",
};

const FRESH = [
  "Payments, refunds and league credit used",
  "Waiver signatures (everyone signs again)",
  "Players other than captains and co-captains",
  "Games, schedules, scores, RSVPs and kicking orders",
  "Suspensions, incidents and sub requests",
  "Scheduling conflicts, promo codes, photos and giveaways",
  "Permit numbers, costs and documents (apply for the new permits)",
];

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

async function Rollover({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/rollover">) {
  const { season: slug } = await params;
  const page = `/app/admin/seasons/${slug}/rollover`;
  await requirePermission("season.manage", { next: page });
  const query = await searchParams;
  const league = await currentLeague(db);
  const source = league
    ? await rolloverSource(db, league.id, slug, new Date())
    : null;
  if (!league || !source) notFound();
  const s = source.season;
  const tz = source.timeZone;

  const one = (name: string) => {
    const value = query[name];
    return typeof value === "string" ? value : undefined;
  };
  const startsOn = one("startsOn") ?? suggestedStart(s.startsOn, s.endsOn);
  const name =
    one("name") ?? suggestedName(s.name, daysBetween(s.startsOn, startsOn));
  // The checkboxes count once the admin has used the form; before that,
  // every team that played is ticked.
  const picked =
    one("chosen") === "1"
      ? new Set([query.team ?? []].flat())
      : new Set(
          source.teams.filter(playedTheSeason).map((t) => t.teamSeasonId),
        );
  const plan = rolloverPlan(source, { name, startsOn, teamIds: picked });
  const error = one("error");
  const problem = error
    ? new Map(Object.entries(PROBLEMS)).get(error)
    : undefined;
  const taken = plan.ok && (await slugInUse(db, league.id, plan.value.slug));
  const day = (on: string) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${on}T12:00:00Z`));
  const when = (at: Date | null) => (at ? fullWhen(at, tz) : "not set");
  const price =
    s.feeModel === "per_team"
      ? `${formatCents(s.teamFeeCents ?? 0)} a team`
      : `${formatCents(s.playerFeeCents ?? 0)} a player`;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/admin/seasons/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {s.name}
        </Link>
        <h1 className="text-h1">Start the next season</h1>
        <p className="text-text-muted">
          Makes a new draft season from {s.name}: the same settings, teams and
          captains, and permit hours on the new dates. Players see nothing until
          you open registration.
        </p>
      </header>

      {problem && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {problem}
        </p>
      )}

      <form method="get" action={page} className="flex flex-col gap-4">
        <input type="hidden" name="chosen" value="1" />
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-small">New season&apos;s name</span>
            <input
              name="name"
              autoComplete="off"
              defaultValue={name}
              maxLength={60}
              required
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small">First day</span>
            <input
              type="date"
              name="startsOn"
              defaultValue={startsOn}
              required
              className={input}
            />
          </label>
        </div>
        {source.teams.length > 0 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-small">Teams to bring along</legend>
            {source.teams.map((t) => (
              <label
                key={t.teamSeasonId}
                className="flex min-h-11 items-center gap-2"
              >
                <input
                  type="checkbox"
                  name="team"
                  value={t.teamSeasonId}
                  defaultChecked={picked.has(t.teamSeasonId)}
                  className="size-5"
                />
                <span>
                  {t.name}
                  <span className="block text-small text-text-muted">
                    {t.captains.length > 0
                      ? t.captains
                          .map(
                            (c) =>
                              `${c.name} (${c.role === "captain" ? "captain" : "co-captain"})`,
                          )
                          .join(", ")
                      : "No captain to bring"}
                    {t.leftOut.length > 0 &&
                      ` · ${t.leftOut.join(", ")} stays out (suspended)`}
                    {!playedTheSeason(t) && ` · ${t.status} this season`}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <SubmitButton className="btn self-start btn-secondary">
          Update the preview
        </SubmitButton>
      </form>

      {plan.ok ? (
        <section aria-labelledby="preview" className="flex flex-col gap-4">
          <h2 id="preview" className="text-h2">
            What {plan.value.name} gets
          </h2>
          {taken && (
            <p role="status" className="rounded-lg border border-warning p-3">
              {PROBLEMS.duplicate}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-text-muted">Season</dt>
            <dd>
              {day(plan.value.dates.startsOn)} to {day(plan.value.dates.endsOn)}{" "}
              (everything moves {plan.value.days} days)
            </dd>
            <dt className="text-text-muted">Registration</dt>
            <dd>
              Opens {when(plan.value.dates.registrationOpensAt)}, closes{" "}
              {when(plan.value.dates.registrationClosesAt)}
            </dd>
            <dt className="text-text-muted">Payment deadline</dt>
            <dd>{when(plan.value.dates.paymentDeadlineAt)}</dd>
            <dt className="text-text-muted">Price</dt>
            <dd>
              {price}
              {s.earlyBirdDiscountCents
                ? `, ${formatCents(s.earlyBirdDiscountCents)} off until ${when(plan.value.dates.earlyBirdEndsAt)}`
                : ""}
            </dd>
            <dt className="text-text-muted">Rosters</dt>
            <dd>
              {s.rosterMin} to {s.rosterMax} players
              {s.maxTeams ? `, up to ${s.maxTeams} teams` : ""}
            </dd>
            <dt className="text-text-muted">Divisions</dt>
            <dd>
              {source.divisions.length === 0
                ? "None: one pool"
                : source.divisions
                    .map(
                      (d) =>
                        `${d.name}${d.ruleSetName ? ` (${d.ruleSetName} rules)` : ""}`,
                    )
                    .join(", ")}
            </dd>
            <dt className="text-text-muted">Teams</dt>
            <dd>
              {plan.value.teams.length}, with {plan.value.captainCount}{" "}
              {plan.value.captainCount === 1 ? "captain" : "captains"} and
              co-captains, each still to sign the waiver and pay
            </dd>
            <dt className="text-text-muted">Permit hours</dt>
            <dd>
              {plan.value.windows.length === 0
                ? "None"
                : `${plan.value.windows.length} windows, from ${fullWhen(
                    plan.value.windows[0]?.newStartsAt ?? new Date(),
                    tz,
                  )}, all as requested`}
            </dd>
          </dl>
          <div className="flex flex-col gap-1">
            <h3 className="text-h3">Starts fresh</h3>
            <ul className="list-disc pl-5">
              {FRESH.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <form action={rollOverAction.bind(null, slug)}>
            <input
              type="hidden"
              name="name"
              autoComplete="off"
              value={plan.value.name}
            />
            <input
              type="hidden"
              name="startsOn"
              value={plan.value.dates.startsOn}
            />
            {plan.value.teams.map((t) => (
              <input
                key={t.teamSeasonId}
                type="hidden"
                name="team"
                value={t.teamSeasonId}
              />
            ))}
            <SubmitButton className="btn btn-primary" disabled={taken}>
              Create {plan.value.name} as a draft
            </SubmitButton>
          </form>
        </section>
      ) : (
        <p role="status" className="rounded-lg border border-warning p-3">
          {PROBLEMS[plan.error]}
        </p>
      )}
    </>
  );
}
