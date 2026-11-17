import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import { db, txDb } from "@/db/client";
import {
  currentScoreState,
  gameForScoring,
  settleGame,
} from "@/db/queries/scores";
import { Pickups } from "@/components/pickups";
import { pickupsFor } from "@/db/queries/subs";
import { hasReferee, liveGame } from "@/db/queries/live-scores";
import { permitInfoFor } from "@/db/queries/permit-watch";
import { GameClock } from "@/components/game-clock";
import { kickoff } from "@/domain/schedule/format";
import { can, hasAdminRole } from "@/domain/authz/permissions";
import { type GameId, parseId } from "@/domain/ids";
import { lineFinal } from "@/domain/scores/live";
import { scoreVersion } from "@/domain/scores/offline";
import {
  needsSettling,
  PLAYOFF_TIE,
  REASON_MAX,
  reportingTeam,
  respondingTeams,
  rulingNeedsReason,
} from "@/domain/scores/scores";
import { requirePermission } from "@/lib/auth/permission";
import { gameCards } from "@/db/queries/cards";
import { gamePeople, teamRatingFor } from "@/db/queries/discipline";
import { canGiveCard } from "@/domain/discipline/cards";
import { canFileFor, canRate } from "@/domain/discipline/discipline";
import { markOpen } from "@/domain/attendance/attendance";
import { cardsVisible } from "@/domain/emergency/emergency";
import { featureEnabled } from "@/lib/platform/site";
import { respondAction } from "./actions";
import { rateSportsmanshipAction } from "./rate";
import { CardsSection } from "./cards-section";
import { GameOutbox, ScoreForm } from "./score-form";
import { SportsmanshipForm } from "./sportsmanship-form";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { activeLeague } from "@/lib/league/active";
import { LeagueLink } from "@/components/league-link";
import { calledNote, scoreFormRules, sportRules } from "@/domain/sports/sports";

export const metadata: Metadata = { title: "Score" };

export default function ScorePage(
  props: PageProps<"/[lang]/app/games/[game]/score">,
) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <Suspense fallback={<PageLoading>Loading the game…</PageLoading>}>
        <Score {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  invalid:
    "Check the score: runs from 0 to 99, and 4 or more innings for a called game.",
  not_started: "This game has not started yet.",
  playoff_tie: PLAYOFF_TIE,
  already_final: "This score is final. Ask an admin to correct it.",
  reason_needed:
    "A forfeit, or a change to a score that was reported or is final, needs a written reason.",
  reason_too_long: `Keep the reason under ${REASON_MAX} characters.`,
  too_many:
    "That's a lot of scores for one game. Ask an admin if it still needs fixing.",
  not_yours: "Only the other team's captain can answer this score.",
  already_answered: "Your team has already answered this score.",
  unknown_report: "That score report is gone. Reload the page.",
  bad_score: "Pick a rating from 1 to 5.",
  rating_note_too_long: "Keep the note under 200 characters.",
  not_final: "You can rate the other team once the score is final.",
  bad_color: "Choose a yellow or a red card.",
  unknown_person: "Pick a player from the two teams in this game.",
  not_in_game: "That player isn't on either roster for this game.",
  too_late: "It's too late to record a card for this game.",
  note_too_long: "Keep the note under 200 characters.",
  undo_too_late: "A card can only be taken back within a few minutes.",
  undo_not_found: "That card is already gone.",
};

/** "Mon, Sep 14, 8:00 PM" in the league's time zone. */
const whenIn = (timeZone: string) => (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);

async function Score({
  params,
  searchParams,
}: PageProps<"/[lang]/app/games/[game]/score">) {
  const { game: rawId } = await params;
  const query = await searchParams;
  const subject = await requirePermission("public.view", {
    next: `/app/games/${rawId}/score`,
  });
  const gameId = parseId<GameId>(rawId);
  const found = gameId ? await gameForScoring(db, gameId) : null;
  if (!found) notFound();
  const now = new Date();
  const [{ state, history }, refereed, league, discipline, live, clocks] =
    await Promise.all([
      currentScoreState(db, found, now),
      hasReferee(db, found.id),
      activeLeague(),
      featureEnabled("discipline"),
      liveGame(db, found.id),
      permitInfoFor(db, [found.id]),
    ]);
  // An undisputed score past its 24 hours is settled on the way in. Settling
  // writes only a final score, so the game is read again only then; a game
  // already marked final is not settled again on every visit.
  let g = found;
  if (needsSettling(found.status, state)) {
    await txDb.transaction((tx) => settleGame(tx, found.id, now));
    g = (await gameForScoring(db, found.id)) ?? found;
  }
  const ctx = {
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] as const },
  };
  const mayEnter = can(subject, "score.enter", ctx);
  // The sport's rules (ADR 0087): words, limits, and whether it scores live.
  const rules = sportRules(g.sport);
  const formRules = scoreFormRules(rules, g.bestOf);
  const mayScoreLive =
    rules.score.liveScoring &&
    g.status !== "final" &&
    g.status !== "forfeit" &&
    g.status !== "cancelled" &&
    (!g.startsAt || g.startsAt <= now) &&
    can(subject, "score.live", {
      game: { ...ctx.game, hasReferee: refereed },
    });
  const isAdmin = can(subject, "score.override", {});
  if (!mayEnter && !can(subject, "score.confirm", ctx)) notFound();
  const latest = history.reports[0];
  const tz = league?.timeZone ?? "America/New_York";
  const when = whenIn(tz);
  // The countdown to first pitch and to the end of play (#467), until a
  // score is in.
  const info = clocks.get(g.id);
  const clock =
    info &&
    !info.dayOff &&
    !latest &&
    (g.status === "scheduled" || g.status === "in_progress")
      ? {
          firstPitchAt: info.clockStartsAt.toISOString(),
          startedAt: info.startedAt?.toISOString() ?? null,
          endsAt: info.end.endsAt.toISOString(),
          endReason: info.end.reason,
          endLabel: kickoff(info.end.endsAt, tz),
          sunsetLabel: info.sunsetAt ? kickoff(info.sunsetAt, tz) : null,
        }
      : null;
  const myTeam = [g.teamAId, g.teamBId].find((t) =>
    subject.roster.some(
      (m) =>
        m.teamSeasonId === t &&
        (m.role === "captain" || m.role === "co_captain"),
    ),
  );
  const mayAnswer =
    latest !== undefined &&
    state.state === "awaiting" &&
    myTeam !== undefined &&
    respondingTeams(
      {
        id: latest.id,
        role: latest.role,
        teamSeasonId: latest.teamSeasonId,
        reportedAt: latest.reportedAt,
      },
      [g.teamAId, g.teamBId],
    ).includes(myTeam) &&
    !history.responses.some(
      (r) => r.reportId === latest.id && r.teamSeasonId === myTeam,
    );
  // A ref who plays for one of the teams reports for it (#296): say so.
  const refSide =
    mayEnter && !isAdmin && subject.refereeGameIds.includes(g.id)
      ? reportingTeam("referee", subject.roster, [g.teamAId, g.teamBId])
      : null;
  const shown = (r: NonNullable<typeof latest>) =>
    r.outcome === "forfeit_a"
      ? `${g.teamAName} forfeited`
      : r.outcome === "forfeit_b"
        ? `${g.teamBName} forfeited`
        : `${g.teamAName} ${r.scoreA}, ${g.teamBName} ${r.scoreB}${r.outcome === "called" ? calledNote(r.inningsPlayed) : ""}`;
  // An admin's written ruling stands as the final result.
  const ruled = state.state === "final" && g.ruledAt !== null;
  const error =
    query.error === "invalid" && rules.key !== "kickball"
      ? `Check the score: ${formRules.unit} from 0 to ${formRules.max}. ${formRules.calledRule}`
      : typeof query.error === "string"
        ? ERRORS[query.error]
        : undefined;
  const form = {
    g: { id: g.id, teamAName: g.teamAName, teamBName: g.teamBName },
    clientId: randomUUID(),
    version: scoreVersion(history.reports, history.responses),
    userId: subject.userId,
    asAdmin: isAdmin,
    reasonRequired: rulingNeedsReason({
      outcome: "normal",
      hasReports: history.reports.length > 0,
      closed: g.status === "final" || g.status === "forfeit",
    }),
    rules: formRules,
  };
  // Innings kept live fill in the final score, so saving it takes one tap.
  const filled = live?.kicksFirst
    ? lineFinal(live.halves, live.kicksFirst)
    : null;
  // Game-day discipline: a captain rates the other team once the score is
  // final; the ref, a captain or an admin can report an incident.
  const rates =
    discipline &&
    myTeam !== undefined &&
    canRate(g) &&
    can(subject, "sportsmanship.rate", ctx);
  // The pickups and this captain's rating, read at once.
  const [pickups, myRating] = await Promise.all([
    can(subject, "sub_request.view_pickups", ctx)
      ? pickupsFor(db, [g.id]).then((m) => m.get(g.id))
      : undefined,
    rates ? teamRatingFor(db, g.id, myTeam) : null,
  ]);
  const reports =
    discipline && canFileFor(g, now).ok && can(subject, "incident.log", ctx);
  // Cards, a calm-down tool for the ref (and admins): never public.
  const showsCards = discipline && can(subject, "card.give", ctx);
  const [cardList, cardPeople] = showsCards
    ? await Promise.all([gameCards(db, g.id), gamePeople(db, g)])
    : [[], []];
  const mayGiveCard =
    showsCards && canGiveCard(g, now, { isAdmin: hasAdminRole(subject) }).ok;
  // From game day, who played (ADR 0063).
  const takesAttendance =
    can(subject, "attendance.take", ctx) &&
    markOpen(
      { status: g.status, startsAt: g.startsAt, timeZone: tz },
      now,
      can(subject, "score.override"),
    ).ok;
  // On game day, the players' emergency contacts (ADR 0043).
  const emergencyShown = cardsVisible(
    { status: g.status, startsAt: g.startsAt, timeZone: tz },
    {
      captainsGame: can(subject, "emergency_contact.view", ctx),
      refereesGame: false,
    },
    now,
  ).ok;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-text-muted">
          {g.seasonName}
          {g.startsAt && ` · ${when(g.startsAt)}`}
          {g.fieldName && ` · ${g.fieldName}`}
        </p>
        <h1 className="text-h2">
          {g.teamAName} vs {g.teamBName}
        </h1>
        <HelpLink
          audience="captain"
          article="scores"
          topic="entering and confirming scores"
        />
        <Pickups
          pickups={pickups}
          teams={[
            { id: g.teamAId, name: g.teamAName },
            { id: g.teamBId, name: g.teamBName },
          ]}
        />
        <Link
          href={`/app/games/${g.id}/lineup`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Kicking orders
        </Link>
        {can(subject, "permit.view_at_field", ctx) && (
          <Link
            href={`/app/games/${g.id}/permit`}
            className="inline-flex min-h-11 items-center self-start underline"
          >
            Park permit for this game
          </Link>
        )}
      </header>
      <GameOutbox gameId={g.id} />
      {clock && <GameClock clock={clock} />}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {(query.carded || query.uncarded) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.carded ? "Card given." : "Card taken back."}
        </p>
      )}
      {(query.saved || query.confirmed || query.disputed) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {query.confirmed
            ? "Confirmed. The score is final."
            : query.disputed
              ? "Disputed. An admin will sort it out."
              : "Score saved."}
        </p>
      )}

      {state.state === "final" && (
        <section
          aria-label="Final score"
          className="rounded-lg border border-border p-4"
        >
          <p className="text-small text-text-muted">
            {ruled
              ? g.status === "forfeit"
                ? "Forfeit ruling"
                : "Ruling"
              : "Final"}
          </p>
          <p className="text-h3">{latest ? shown(latest) : "Final"}</p>
          {ruled && latest?.reason && (
            <>
              <p>Reason: “{latest.reason}”</p>
              <p className="text-small text-text-muted">
                An admin ruled on {when(latest.reportedAt)}. Questions? Ask the
                league.
              </p>
            </>
          )}
        </section>
      )}
      {state.state === "awaiting" && latest && (
        <section
          aria-label="Reported score"
          className="flex flex-col gap-3 rounded-lg border border-border p-4"
        >
          <p className="text-small text-text-muted">
            Reported by {latest.reporterName}
          </p>
          <p className="text-h3">{shown(latest)}</p>
          <p className="text-small text-text-muted">
            Final when{" "}
            {respondingTeams(
              {
                id: latest.id,
                role: latest.role,
                teamSeasonId: latest.teamSeasonId,
                reportedAt: latest.reportedAt,
              },
              [g.teamAId, g.teamBId],
            ).length === 2
              ? "either captain confirms"
              : "the other team confirms"}
            , or on {when(state.finalAt)} if nobody disputes it.
          </p>
          {mayAnswer && (
            <form
              action={respondAction.bind(null, g.id, latest.id)}
              className="flex flex-col gap-2"
            >
              <label className="flex flex-col gap-1">
                Note, if you dispute it
                <input
                  name="note"
                  maxLength={300}
                  className="min-h-11 rounded-md border border-border bg-surface px-3 py-2"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <SubmitButton
                  name="status"
                  value="confirmed"
                  className="btn btn-primary"
                >
                  Confirm
                </SubmitButton>
                <SubmitButton
                  name="status"
                  value="disputed"
                  className="btn btn-secondary"
                >
                  Dispute
                </SubmitButton>
              </div>
            </form>
          )}
        </section>
      )}
      {state.state === "disputed" && latest && (
        <section
          aria-label="Disputed score"
          className="flex flex-col gap-1 rounded-lg border border-warning p-4"
        >
          <p className="text-small text-text-muted">Disputed</p>
          <p className="text-h3">{shown(latest)}</p>
          {history.responses
            .filter((r) => r.reportId === latest.id && r.note)
            .map((r) => (
              <p key={r.teamSeasonId} className="text-small">
                “{r.note}”
              </p>
            ))}
          <p className="text-small text-text-muted">
            An admin will set the final score.
          </p>
        </section>
      )}

      {mayScoreLive && state.state === "none" && (
        <section aria-labelledby="keep-live" className="flex flex-col gap-2">
          <h2 id="keep-live" className="sr-only">
            Live score
          </h2>
          <Link href={`/app/games/${g.id}/live`} className="btn btn-primary">
            {filled ? "Back to the live score" : "Keep score live"}
          </Link>
          {!filled && (
            <p className="text-small text-text-muted">
              Optional. Tap +1 for each run and End half after each half, and
              fans follow along on the game page. At the end, one tap reports
              the final score, and the captains confirm it as usual.
            </p>
          )}
        </section>
      )}

      {refSide && (
        <p className="rounded-lg border border-warning p-3 text-small">
          You play for {refSide === g.teamAId ? g.teamAName : g.teamBName}, so
          your report counts as that team&rsquo;s. Only{" "}
          {refSide === g.teamAId ? g.teamBName : g.teamAName} can confirm or
          dispute it.
        </p>
      )}

      {mayEnter &&
        (state.state === "none" ? (
          <ScoreForm {...form} label="Save the score" filled={filled} />
        ) : state.state !== "final" || isAdmin ? (
          <details className="rounded-lg border border-border p-3">
            <summary>
              {isAdmin
                ? "Set the score as an admin"
                : "Report a different score"}
            </summary>
            <div className="mt-3">
              <ScoreForm
                {...form}
                label={isAdmin ? "Save as the final score" : "Save the score"}
              />
            </div>
          </details>
        ) : null)}

      {query.rated && (
        <p role="status" className="rounded-lg border border-success p-3">
          Thanks. Your rating is saved.
        </p>
      )}
      {rates && (
        <SportsmanshipForm
          action={rateSportsmanshipAction.bind(null, g.id)}
          opponent={myTeam === g.teamAId ? g.teamBName : g.teamAName}
          current={myRating}
        />
      )}
      {takesAttendance && (
        <Link href={`/app/games/${g.id}/attendance`} className="underline">
          Check-in
        </Link>
      )}
      {emergencyShown && (
        <Link href={`/app/games/${g.id}/emergency`} className="underline">
          Emergency contacts
        </Link>
      )}
      {showsCards && (
        <CardsSection
          gameId={g.id}
          teams={[
            { id: g.teamAId, name: g.teamAName },
            { id: g.teamBId, name: g.teamBName },
          ]}
          people={cardPeople}
          cards={cardList}
          viewer={{ userId: subject.userId, isAdmin: hasAdminRole(subject) }}
          now={now}
          canGive={mayGiveCard}
          timeZone={tz}
        />
      )}
      {reports && (
        <Link href={`/app/games/${g.id}/incident`} className="underline">
          Report an incident
        </Link>
      )}

      {history.reports.length > 1 && (
        <section aria-labelledby="history" className="flex flex-col gap-1">
          <h2 id="history" className="text-h3">
            History
          </h2>
          <ul className="text-small text-text-muted">
            {history.reports.map((r) => (
              <li key={r.id}>
                {when(r.reportedAt)}: {r.reporterName} reported {shown(r)}
                {r.reason && ` (ruling: “${r.reason}”)`}
              </li>
            ))}
          </ul>
        </section>
      )}
      <LeagueLink
        href={`/seasons/${g.seasonSlug}/standings`}
        className="underline"
      >
        Standings
      </LeagueLink>
    </>
  );
}
