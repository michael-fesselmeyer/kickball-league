import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  privateEventBySeason,
  privateEventTeams,
} from "@/db/queries/private-events";
import { publishedSchedule } from "@/db/queries/public-schedule";
import { can } from "@/domain/authz/permissions";
import { money } from "@/domain/books/ledger";
import { fullWhen } from "@/domain/schedule/format";
import {
  hasResult,
  placeLine,
  resultLine,
  statusLabel,
} from "@/domain/schedule/public-game";
import { env } from "@/env";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { absoluteUrl, siteOrigin } from "@/lib/site";
import { payForPrivateEventAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Organizer page" };

const TEAM_STATUS = {
  forming: "Forming",
  pending_payment: "Waiting on payment",
  confirmed: "Confirmed",
} as const;

export default function OrganizerPage(
  props: PageProps<"/[lang]/app/private-events/[season]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<div className="min-h-svh" aria-busy="true" />}>
        <Organizer {...props} />
      </Suspense>
    </main>
  );
}

async function Organizer({
  params,
  searchParams,
}: PageProps<"/[lang]/app/private-events/[season]">) {
  const { season: slug } = await params;
  const page = `/app/private-events/${slug}`;
  const league = await activeLeague();
  if (!league) notFound();
  const event = await privateEventBySeason(db, league.id, slug);
  // Its organizer and the league's admins; anyone else gets a 404.
  const subject = await requirePermission("private_event.organize", {
    next: page,
    targetUserId: event?.organizerId ?? "",
  });
  if (!event?.seasonId) notFound();
  const query = await searchParams;
  const seasonId = event.seasonId;
  const [teams, games] = await Promise.all([
    privateEventTeams(db, seasonId),
    publishedSchedule(db, seasonId, "mine"),
  ]);
  const admin = can(subject, "private_event.manage", {});
  const invite = event.inviteToken
    ? absoluteUrl(
        siteOrigin(env.BETTER_AUTH_URL),
        `/app/private-events/join/${event.inviteToken}`,
      )
    : null;
  const results = games.filter(hasResult);
  const upcoming = games.filter((g) => !hasResult(g));
  const tz = league.timeZone;

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href="/app/private-events"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Private leagues and tournaments
        </Link>
        <h1 className="text-h1">{event.seasonName}</h1>
        <p className="text-text-muted">
          {event.kind === "tournament" ? "Tournament" : "Private league"} for{" "}
          {event.organization}. Private: only invited teams can join, and none
          of it shows on the league&apos;s public pages.
        </p>
      </header>

      {query.paid === "1" && (
        <p role="status" className="rounded-lg border border-success p-3">
          Thanks! Stripe is confirming the payment; this page shows it as paid
          in a moment.
        </p>
      )}
      {typeof query.error === "string" && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {query.error === "payments_off"
            ? "Payments aren't switched on. Ask the league how to pay."
            : query.error === "too_many"
              ? "That's a lot of checkouts in an hour. Wait a bit, then try again."
              : "Stripe couldn't start the payment. Try again in a minute."}
        </p>
      )}

      <section aria-labelledby="invite" className="flex flex-col gap-3">
        <h2 id="invite" className="text-h2">
          Invite your teams
        </h2>
        <p>
          Send this link to each team&apos;s captain. They sign in, name their
          team and share their team&apos;s own link with their players.
        </p>
        {invite && (
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-muted">Invite link</span>
            <input
              readOnly
              value={invite}
              className="min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
        )}
      </section>

      <section aria-labelledby="payment" className="flex flex-col gap-3">
        <h2 id="payment" className="text-h2">
          Payment
        </h2>
        {event.payer === "organization" ? (
          event.paidAt ? (
            <p>
              Paid: {money(event.priceCents ?? 0)} for every team. Teams join
              free.
            </p>
          ) : event.priceCents ? (
            <>
              <p>
                {event.organization} pays {money(event.priceCents)} once, for
                every team. Teams join free.
              </p>
              <form action={payForPrivateEventAction.bind(null, slug)}>
                <SubmitButton className="btn btn-primary">
                  Pay {money(event.priceCents)}
                </SubmitButton>
              </form>
            </>
          ) : (
            <p>Nothing to pay: the league is hosting this one.</p>
          )
        ) : (
          <p>
            Players pay their own share
            {event.playerFeeCents
              ? ` of ${money(event.playerFeeCents)} each`
              : ""}{" "}
            when they join, as in a league season.
          </p>
        )}
      </section>

      <section aria-labelledby="teams" className="flex flex-col gap-3">
        <h2 id="teams" className="text-h2">
          Teams ({teams.length} of {event.teams})
        </h2>
        {teams.length === 0 ? (
          <p className="text-text-muted">No teams yet.</p>
        ) : (
          <ul className="flex flex-col">
            {teams.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border py-2"
              >
                <span>{t.name}</span>
                <span className="text-small text-text-muted">
                  {t.players} {t.players === 1 ? "player" : "players"} ·{" "}
                  {TEAM_STATUS[t.status as keyof typeof TEAM_STATUS] ??
                    t.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="schedule" className="flex flex-col gap-3">
        <h2 id="schedule" className="text-h2">
          Schedule
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-text-muted">
            {games.length === 0
              ? "The league publishes the schedule once the teams are in."
              : "Every game has been played."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {upcoming.map((g) => (
              <li key={g.id} className="border-b border-border py-2">
                {g.teamA.name} vs {g.teamB.name}
                <span className="block text-small text-text-muted">
                  {g.startsAt ? fullWhen(g.startsAt, tz) : "Time to come"}
                  {placeLine(g) ? ` · ${placeLine(g)}` : ""}
                  {statusLabel(g) ? ` · ${statusLabel(g)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="results" className="flex flex-col gap-3">
        <h2 id="results" className="text-h2">
          Results
        </h2>
        {results.length === 0 ? (
          <p className="text-text-muted">No results yet.</p>
        ) : (
          <ul className="flex flex-col">
            {results.map((g) => (
              <li key={g.id} className="border-b border-border py-2">
                {resultLine(g)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {admin && (
        <section aria-labelledby="admin" className="flex flex-col gap-3">
          <h2 id="admin" className="text-h2">
            For admins
          </h2>
          <p className="text-text-muted">
            Add its field time, then build a round robin on the schedule screen
            or a bracket on the playoffs screen, as for any season.
          </p>
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["fields", "Fields and permits"],
                ["schedule", "Schedule"],
                ["playoffs", "Bracket"],
                ["", "Season settings"],
              ] as const
            ).map(([path, label]) => (
              <Link
                key={label}
                href={`/app/admin/seasons/${slug}${path ? `/${path}` : ""}`}
                className="btn btn-secondary"
              >
                {label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
