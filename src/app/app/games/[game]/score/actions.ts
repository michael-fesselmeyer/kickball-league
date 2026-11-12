"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  currentScoreState,
  gameForScoring,
  reportScore,
  respondToScore,
} from "@/db/queries/scores";
import { can, type Subject } from "@/domain/authz/permissions";
import { isOneOf } from "@/domain/guards";
import {
  type GameId,
  parseId,
  type ScoreReportId,
  type TeamSeasonId,
} from "@/domain/ids";
import { OUTCOMES, respondingTeams } from "@/domain/scores/scores";
import { requirePermission } from "@/lib/auth/permission";

const pageFor = (gameId: string) => `/app/games/${gameId}/score`;

/** The game and the viewer's role in it, or a 404. */
async function context(rawGameId: string) {
  const gameId = parseId<GameId>(rawGameId);
  const page = pageFor(rawGameId);
  const subject = await requirePermission("public.view", { next: page });
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  const gameContext = {
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] as const },
  };
  return { page, subject, g, gameContext };
}

/** The viewer's team in this game, if they captain one of the two. */
function captainedTeam(
  subject: Subject,
  teams: readonly [TeamSeasonId, TeamSeasonId],
): TeamSeasonId | null {
  return (
    teams.find((t) =>
      subject.roster.some(
        (m) =>
          m.teamSeasonId === t &&
          (m.role === "captain" || m.role === "co_captain"),
      ),
    ) ?? null
  );
}

const number = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : Number.NaN;
};

export async function submitScoreAction(
  rawGameId: string,
  clientId: string,
  form: FormData,
): Promise<void> {
  const { page, subject, g, gameContext } = await context(rawGameId);
  if (!can(subject, "score.enter", gameContext)) notFound();
  const outcome = form.get("outcome");
  if (!isOneOf(OUTCOMES, outcome)) redirect(`${page}?error=invalid`);
  const team = captainedTeam(subject, [g.teamAId, g.teamBId]);
  const role =
    subject.globalRole === "admin" || subject.globalRole === "owner"
      ? "admin"
      : team
        ? "captain"
        : "referee";
  const innings = number(form, "inningsPlayed");
  const result = await txDb.transaction((tx) =>
    reportScore(tx, {
      gameId: g.id,
      userId: subject.userId,
      role,
      teamSeasonId: role === "captain" ? team : null,
      score: {
        outcome,
        scoreA: number(form, "scoreA"),
        scoreB: number(form, "scoreB"),
        inningsPlayed: Number.isNaN(innings) ? null : innings,
      },
      clientId: clientId.slice(0, 64),
      now: new Date(),
    }),
  );
  if (!result.ok)
    redirect(
      `${page}?error=${typeof result.error === "string" ? result.error : "invalid"}`,
    );
  redirect(`${page}?saved=1`);
}

export async function respondAction(
  rawGameId: string,
  rawReportId: string,
  form: FormData,
): Promise<void> {
  const { page, subject, g, gameContext } = await context(rawGameId);
  if (!can(subject, "score.confirm", gameContext)) notFound();
  const reportId = parseId<ScoreReportId>(rawReportId);
  const status = form.get("status");
  if (!reportId || (status !== "confirmed" && status !== "disputed"))
    redirect(`${page}?error=invalid`);
  // Only a captain of a team allowed to answer this report may.
  const team = captainedTeam(subject, [g.teamAId, g.teamBId]);
  const { history } = await currentScoreState(db, g, new Date());
  const report = history.reports.find((r) => r.id === reportId);
  if (
    !team ||
    !report ||
    !respondingTeams(
      {
        id: report.id,
        role: report.role,
        teamSeasonId: report.teamSeasonId,
        reportedAt: report.reportedAt,
      },
      [g.teamAId, g.teamBId],
    ).includes(team)
  )
    redirect(`${page}?error=not_yours`);
  const note = form.get("note");
  const result = await txDb.transaction((tx) =>
    respondToScore(tx, {
      gameId: g.id,
      reportId,
      teamSeasonId: team,
      userId: subject.userId,
      status,
      note: typeof note === "string" ? note : "",
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?${status}=1`);
}
