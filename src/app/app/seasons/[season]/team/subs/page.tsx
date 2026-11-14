import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import {
  myRegistration,
  seasonForRegistration,
} from "@/db/queries/registration";
import { rulesFor, teamRsvps } from "@/db/queries/rsvps";
import { teamGames } from "@/db/queries/scores";
import { currentLeague } from "@/db/queries/seasons";
import {
  MAX_OPEN_PER_TEAM,
  type TeamSubRequest,
  teamSubRequests,
} from "@/db/queries/subs";
import { can } from "@/domain/authz/permissions";
import {
  canPostFor,
  describeSpots,
  suggestSubs,
} from "@/domain/subs/eligibility";
import { requirePermission } from "@/lib/auth/permission";
import {
  cancelRequestAction,
  decideClaimAction,
  postSubRequestAction,
} from "./actions";
import { requireFeature } from "@/lib/platform/site";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Find subs" };

export default function TeamSubsPage(
  props: PageProps<"/app/seasons/[season]/team/subs">,
) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading your requests…</PageLoading>}>
        <TeamSubs {...props} />
      </Suspense>
    </main>
  );
}

/** Messages by error code; an unknown code from the URL finds nothing. */
const ERRORS: Record<string, string> = {
  playoff: "Sub requests are off for playoff games, as the rulebook says.",
  not_placed: "That game has no time on the schedule yet.",
  started: "That game has started, so it's too late to ask for subs.",
  game_over: "That game is over.",
  not_your_game: "That isn't one of your team's games.",
  invalid_spots:
    "Ask for 1 to 11 subs, with no more spots for women and men than that.",
  already_posted:
    "You already have a request up for that game. Take it down to post a new one.",
  too_many_open: `You can have ${MAX_OPEN_PER_TEAM} requests up at once. Take one down first.`,
  not_pending: "Someone already answered that claim.",
  closed: "That request is closed.",
  not_found: "That request is gone. Reload the page.",
};

const NOTICES: Record<string, string> = {
  approved: "Approved. They'll get an email saying they're playing.",
  declined: "Declined. Their spot is open again, and they'll hear thanks.",
  cancelled: "Request taken down. Anyone holding a spot has been told.",
};

const GROUP: Record<string, string> = { woman: "woman", man: "man" };

const STATUS: Record<string, string> = {
  pending: "Wants to play",
  approved: "Playing",
  declined: "Declined",
  withdrawn: "Dropped out",
};

const field =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 tabular-nums";

function RequestCard({
  request,
  label,
  slug,
}: {
  request: TeamSubRequest;
  label: string;
  slug: string;
}) {
  const holding = request.claims.filter(
    (c) => c.status === "pending" || c.status === "approved",
  ).length;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{label}</strong>
        <span className="text-small text-text-muted">
          {request.status === "filled"
            ? "Filled"
            : `${request.spots.needed - holding} of ${request.spots.needed} open`}
        </span>
      </div>
      <p>
        Looking for {describeSpots(request.spots)}.
        {request.note && (
          <span className="text-text-muted"> “{request.note}”</span>
        )}
      </p>
      {request.claims.length === 0 ? (
        <p className="text-small text-text-muted">
          Nobody has offered yet. Players hear about it by email.
        </p>
      ) : (
        <ul className="flex flex-col">
          {request.claims.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
            >
              <span>
                {c.name}
                <span className="text-small text-text-muted">
                  {" "}
                  · {c.lineupGender
                    ? GROUP[c.lineupGender]
                    : "group not set"} · {STATUS[c.status]}
                </span>
              </span>
              {c.status === "pending" && (
                <span className="flex gap-2">
                  <form
                    action={decideClaimAction.bind(
                      null,
                      slug,
                      c.id,
                      "approved",
                    )}
                  >
                    <button type="submit" className="btn btn-primary">
                      Approve<span className="sr-only"> {c.name}</span>
                    </button>
                  </form>
                  <form
                    action={decideClaimAction.bind(
                      null,
                      slug,
                      c.id,
                      "declined",
                    )}
                  >
                    <button type="submit" className="btn btn-secondary">
                      Decline<span className="sr-only"> {c.name}</span>
                    </button>
                  </form>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <form action={cancelRequestAction.bind(null, slug, request.id)}>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center underline"
        >
          Take this request down<span className="sr-only">: {label}</span>
        </button>
      </form>
    </li>
  );
}

async function TeamSubs({
  params,
  searchParams,
}: PageProps<"/app/seasons/[season]/team/subs">) {
  await requireFeature("subs");
  const { season: slug } = await params;
  const query = await searchParams;
  const page = `/app/seasons/${slug}/team/subs`;
  const subject = await requirePermission("registration.join", { next: page });
  const league = await currentLeague(db);
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season) notFound();
  const mine = await myRegistration(db, season.id, subject.userId);
  const team = mine?.team;
  if (
    !team ||
    !can(subject, "sub_request.post", { teamSeasonId: team.teamSeasonId })
  )
    notFound();

  const now = new Date();
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: league?.timeZone ?? "America/New_York",
    }).format(d);
  const games = (await teamGames(db, team.teamSeasonId)).filter(
    (g) => g.startsAt !== null && g.startsAt > now,
  );
  const labelOf = (gameId: string) => {
    const g = games.find((x) => x.id === gameId);
    return g?.startsAt
      ? `${when(g.startsAt)} vs ${g.opponent}${g.fieldName ? `, ${g.fieldName}` : ""}`
      : "A game";
  };
  const requests = await teamSubRequests(db, team.teamSeasonId, now);
  const requested = new Set(requests.map((r) => r.gameId as string));

  // The form for one game, chosen from the team page or the list below.
  const chosen =
    typeof query.game === "string"
      ? games.find((g) => g.id === query.game && !requested.has(g.id))
      : undefined;
  const allowed = chosen
    ? canPostFor(
        {
          kind: chosen.kind,
          status: chosen.status,
          teamSeasonIds: [chosen.teamAId, chosen.teamBId],
          startsAt: chosen.startsAt,
          endsAt: null,
        },
        now,
      )
    : null;
  const rsvp = chosen
    ? (await teamRsvps(db, team.teamSeasonId, [chosen.id])).get(chosen.id)
    : undefined;
  const suggestion =
    chosen && rsvp
      ? suggestSubs(rsvp.coming, await rulesFor(db, chosen.id))
      : null;
  const prefill =
    suggestion && suggestion.needed > 0
      ? suggestion
      : { needed: 1, womenNeeded: 0, menNeeded: 0 };

  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const posted =
    typeof query.posted === "string" && /^\d+$/.test(query.posted)
      ? Number(query.posted)
      : null;

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href={`/app/seasons/${slug}/team`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {team.teamName}
        </Link>
        <h1 className="text-h1">Find subs</h1>
        <p className="text-text-muted">
          Short for a game? Ask here and we&apos;ll email registered players who
          are free then, free agents first. They tap &quot;I&apos;m in&quot; and
          you approve who plays. Not for playoff games.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {(notice || posted !== null) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {posted !== null
            ? posted === 0
              ? "Request posted. Nobody who fits is free right now, but anyone can still find it on the sub page."
              : `Request posted. We're emailing ${posted} ${posted === 1 ? "player" : "players"} who could sub.`
            : notice}
        </p>
      )}

      {chosen && chosen.startsAt && (
        <section aria-labelledby="ask" className="flex flex-col gap-3">
          <h2 id="ask" className="text-h2">
            Ask for subs: {labelOf(chosen.id)}
          </h2>
          {allowed && !allowed.ok ? (
            <p>{ERRORS[allowed.error]}</p>
          ) : (
            <form
              action={postSubRequestAction.bind(null, slug, chosen.id)}
              className="flex flex-col gap-4 rounded-lg border border-border p-4"
            >
              {rsvp && (
                <p className="text-small">
                  <span className="text-text-muted">
                    {rsvp.in} in ({rsvp.coming.women} women, {rsvp.coming.men}{" "}
                    men
                    {rsvp.coming.unknown > 0
                      ? `, ${rsvp.coming.unknown} not set`
                      : ""}
                    ). {rsvp.fielding.message}{" "}
                  </span>
                  {suggestion && suggestion.needed > 0
                    ? `For a full lineup, ask for ${describeSpots(suggestion)}.`
                    : "You can already field a full lineup from who said they're in."}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  How many subs
                  <input
                    name="needed"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={11}
                    required
                    defaultValue={prefill.needed}
                    className={field}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  At least this many women
                  <input
                    name="womenNeeded"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={11}
                    defaultValue={prefill.womenNeeded}
                    className={field}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  At least this many men
                  <input
                    name="menNeeded"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={11}
                    defaultValue={prefill.menNeeded}
                    className={field}
                  />
                </label>
              </div>
              <p className="text-small text-text-muted">
                Reserved spots follow the fielding rule: only players in that
                fielding group can take them. The rest are open to anyone.
              </p>
              <label className="flex flex-col gap-1">
                Note for players (optional)
                <textarea
                  name="note"
                  maxLength={500}
                  rows={2}
                  placeholder="Wear red. We play at the far field."
                  className="min-h-11 rounded-input border border-border-strong bg-surface px-3 py-2"
                />
              </label>
              <button type="submit" className="btn self-start btn-primary">
                Post and email players
              </button>
            </form>
          )}
        </section>
      )}

      <section aria-labelledby="requests" className="flex flex-col gap-3">
        <h2 id="requests" className="text-h2">
          Your requests
        </h2>
        {requests.length === 0 ? (
          <p className="text-text-muted">
            No requests up. Pick a game below when you&apos;re short.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                label={labelOf(r.gameId)}
                slug={slug}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="upcoming" className="flex flex-col gap-3">
        <h2 id="upcoming" className="text-h2">
          Upcoming games
        </h2>
        {games.length === 0 ? (
          <p className="text-text-muted">No games coming up.</p>
        ) : (
          <ul className="flex flex-col">
            {games.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
              >
                <span>{labelOf(g.id)}</span>
                {g.kind === "playoff" ? (
                  <span className="text-small text-text-muted">
                    Playoffs: no subs
                  </span>
                ) : requested.has(g.id) ? (
                  <span className="text-small text-text-muted">Request up</span>
                ) : (
                  <Link
                    href={`${page}?game=${g.id}#ask`}
                    className="inline-flex min-h-11 items-center underline"
                  >
                    Find subs<span className="sr-only">: {labelOf(g.id)}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
