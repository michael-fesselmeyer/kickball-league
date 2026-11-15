import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import {
  RainDecisionCard,
  RainDecisionCardLoading,
} from "@/components/rain-decision-card";
import { CopyForWhatsApp } from "@/components/share";
import { db } from "@/db/client";
import {
  adminsConfirmRainouts,
  anySlotOpen,
  gameDayParks,
  rainoutRequests,
} from "@/db/queries/rainout-decision";
import { loadVersion } from "@/db/queries/schedule";
import {
  scheduleLabels,
  seasonBySlug,
  versionsOf,
} from "@/db/queries/schedule-screen";
import { can } from "@/domain/authz/permissions";
import type { SeasonId, SlotId } from "@/domain/ids";
import { kickoff, shortDay } from "@/domain/schedule/format";
import { measure } from "@/domain/scheduler/measure";
import { reschedule } from "@/domain/scheduler/reschedule";
import { rainoutShareText } from "@/domain/share/share-text";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { featureEnabled } from "@/lib/platform/site";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { activeLeague, activeLeaguePath } from "@/lib/league/active";
import {
  declareRainout,
  sendRainoutAction,
  setRainoutPolicyAction,
} from "./actions";
import { dayLabel, ERRORS, NOTICES } from "./words";

export const metadata: Metadata = { title: "Rain-out" };

export default function RainoutPage(
  props: PageProps<"/app/admin/seasons/[season]/rainout">,
) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Rainout {...props} />
      </Suspense>
    </main>
  );
}

async function Rainout({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/rainout">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/admin/seasons/${slug}/rainout`;
  const subject = await requirePermission("rainout.prepare", { next: page });
  const league = await activeLeague();
  const season = league ? await seasonBySlug(db, league.id, slug) : null;
  if (!season || !league) notFound();
  // Who confirms (ADR 0057): the owners and the operator, and admins
  // when the owners allow it.
  const adminsConfirm = await adminsConfirmRainouts(db, league.id);
  const canConfirm = can(subject, "rainout.confirm", {
    adminsConfirmRainouts: adminsConfirm,
  });
  const canSetPolicy = can(subject, "rainout.confirm_policy");
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  const published = (await versionsOf(db, season.id)).find(
    (v) => v.status === "published",
  );
  const version = published ? await loadVersion(db, published.id) : null;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const header = (
    <header className="flex flex-col gap-1">
      <p className="text-text-muted">{season.name}</p>
      <h1 className="text-h1">Call a rain-out</h1>
      <HelpLink audience="admin" article="rain-outs" topic="rain-outs" />
      <Link href={`/app/admin/seasons/${slug}/schedule`} className="underline">
        Back to the schedule
      </Link>
    </header>
  );
  if (!version)
    return (
      <>
        {header}
        <p>{ERRORS.no_published}</p>
      </>
    );

  const labels = await scheduleLabels(db, season.id, season.timeZone);
  const slotDate = new Map(version.input.slots.map((s) => [s.id, s.date]));
  const dates = [
    ...new Set(
      version.schedule.games.flatMap((g) =>
        g.slotId ? [slotDate.get(g.slotId)] : [],
      ),
    ),
  ]
    .filter((d): d is string => d !== undefined)
    .sort();
  const date =
    typeof query.date === "string" && dates.includes(query.date)
      ? query.date
      : null;
  const team = (id: string) => labels.teams.get(id) ?? id;
  const where = (slotId: string | null) => {
    const s = slotId ? labels.slots.get(slotId) : undefined;
    return s ? `${s.day}, ${s.time}, ${s.field}` : "No slot";
  };

  let preview = null;
  if (date) {
    const cancelled = version.input.slots
      .filter((s) => s.date === date)
      .map((s) => s.id);
    const result = reschedule(version.input, version.schedule, cancelled);
    const before = measure(version.input, version.schedule);
    const games = new Map(version.schedule.games.map((g) => [g.key, g]));
    const [requests, stillOn] = await Promise.all([
      rainoutRequests(db, season.id, date),
      anySlotOpen(db, cancelled as SlotId[]),
    ]);
    const lastRequest = requests[0];
    preview = (
      <section aria-labelledby="preview" className="flex flex-col gap-4">
        <h2 id="preview" className="text-h2">
          If {dayLabel(date)} is rained out
        </h2>
        <table className="w-full text-left">
          <thead className="text-text-muted">
            <tr>
              <th scope="col">Game</th>
              <th scope="col">Was</th>
              <th scope="col">Makeup</th>
            </tr>
          </thead>
          <tbody>
            {result.moved.map((m) => {
              const g = games.get(m.gameKey);
              return (
                <tr key={m.gameKey} className="border-t border-border">
                  <td>
                    {g ? `${team(g.teamA)} vs ${team(g.teamB)}` : m.gameKey}
                  </td>
                  <td>{where(m.from)}</td>
                  <td className={m.to ? "" : "text-danger"}>{where(m.to)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <dl className="grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-x-6">
          {(
            [
              [
                "Time-slot spread",
                before.timeSlotSpread.value,
                result.metrics.timeSlotSpread.value,
              ],
              [
                "Field spread",
                before.fieldSpread.value,
                result.metrics.fieldSpread.value,
              ],
              [
                "Doubleheader wait",
                before.doubleheaderWait.value,
                result.metrics.doubleheaderWait.value,
              ],
              [
                "Unplaced games",
                before.unplaced.value,
                result.metrics.unplaced.value,
              ],
              [
                "Makeup slots left",
                before.reserveRemaining.value,
                result.metrics.reserveRemaining.value,
              ],
            ] as const
          ).map(([label, was, now]) => (
            <div
              key={label}
              className="flex justify-between gap-3 border-b border-border py-1"
            >
              <dt>{label}</dt>
              <dd>
                {was} → <strong>{now}</strong>
              </dd>
            </div>
          ))}
        </dl>
        {result.schedule.diagnostics
          .filter((d) => !version.schedule.diagnostics.includes(d))
          .map((d) => (
            <p
              key={d}
              role="alert"
              className="rounded-lg border border-warning p-3"
            >
              {d}
            </p>
          ))}
        {!stillOn ? (
          <p role="status" className="rounded-lg border border-border p-3">
            {ERRORS.already}
          </p>
        ) : null}
        {stillOn && lastRequest && (
          <p role="status" className="rounded-lg border border-warning p-3">
            {lastRequest.by ?? "An admin"} sent this rain-out to the owners to
            confirm on {shortDay(lastRequest.at, season.timeZone)} at{" "}
            {kickoff(lastRequest.at, season.timeZone)}.
            {canConfirm
              ? " Confirm it below if the field can't be played."
              : " Waiting for an owner to confirm."}
          </p>
        )}
        {!stillOn ? null : canConfirm ? (
          <>
            <form action={declareRainout.bind(null, slug, date)}>
              <SubmitButton className="btn btn-primary">
                Cancel {dayLabel(date)} and save these makeups as a draft
              </SubmitButton>
            </form>
            <p className="text-text-muted">
              Nothing is published or sent until you publish the draft on the
              schedule screen. Publishing emails each player on a moved team
              their game&apos;s makeup time.
            </p>
          </>
        ) : (
          <>
            <form action={sendRainoutAction.bind(null, slug, date)}>
              <SubmitButton className="btn btn-primary">
                Send {dayLabel(date)} to the owners to confirm
              </SubmitButton>
            </form>
            <p className="text-text-muted">
              Only an owner confirms a rain-out. Each owner gets a message with
              the weather summary and a link back here; nothing is cancelled
              until one of them confirms.
            </p>
          </>
        )}
        <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
          <h3 className="text-h3">For the league chat</h3>
          <p className="text-small text-text-muted">
            Post it after you publish the draft, so the chat and the schedule
            agree.
          </p>
          <CopyForWhatsApp
            about={`rain-out notice for ${dayLabel(date)}`}
            text={rainoutShareText({
              day: dayLabel(date),
              moves: result.moved.map((m) => {
                const g = games.get(m.gameKey);
                return {
                  teams: g ? `${team(g.teamA)} vs ${team(g.teamB)}` : m.gameKey,
                  makeup: m.to ? where(m.to) : null,
                };
              }),
              url: absoluteUrl(
                siteOrigin(env.BETTER_AUTH_URL),
                await activeLeaguePath(`/seasons/${slug}/schedule`),
              ),
            })}
          />
        </div>
      </section>
    );
  }

  return (
    <>
      {header}
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
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Date
          <select
            name="date"
            defaultValue={date ?? undefined}
            className="rounded-md border border-border bg-surface px-2 py-1"
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton className="btn btn-secondary">Preview</SubmitButton>
      </form>
      {date && (await featureEnabled("weather")) && (
        <div id="decision" className="flex flex-col gap-3">
          <Suspense fallback={<RainDecisionCardLoading />}>
            <DayCard
              seasonId={season.id}
              date={date}
              timeZone={season.timeZone}
            />
          </Suspense>
        </div>
      )}
      {preview}
      <section
        id="who-confirms"
        aria-labelledby="who-confirms-heading"
        className="flex flex-col gap-2 border-t border-border pt-6"
      >
        <h2 id="who-confirms-heading" className="text-h3">
          Who confirms rain-outs
        </h2>
        <p>
          {adminsConfirm
            ? "Owners and admins confirm rain-outs."
            : "Owners confirm rain-outs. Admins see everything here and send a rain-out to the owners to confirm."}
        </p>
        {canSetPolicy && (
          <form
            action={setRainoutPolicyAction.bind(null, slug, date)}
            className="flex flex-col items-start gap-2"
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="adminsConfirm"
                defaultChecked={adminsConfirm}
                className="size-5"
              />
              Let admins confirm rain-outs too, for days no owner is around
            </label>
            <SubmitButton className="btn btn-secondary">
              Save who confirms
            </SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}

/** The decision card for the parks a date's games use. */
async function DayCard({
  seasonId,
  date,
  timeZone,
}: {
  seasonId: SeasonId;
  date: string;
  timeZone: string;
}) {
  const parks = await gameDayParks(db, seasonId, date, timeZone);
  return <RainDecisionCard parks={parks} timeZone={timeZone} />;
}
