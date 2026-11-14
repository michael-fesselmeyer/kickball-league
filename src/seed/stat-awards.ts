import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import {
  computeStatAwards,
  setStatAwardsPublished,
} from "@/db/queries/stat-awards";
import {
  awardPoll,
  awardVote,
  game,
  gamePeriod,
  gameRsvp,
  registration,
  rosterMembership,
  sportsmanshipRating,
  subClaim,
  subRequest,
} from "@/db/schema";
import { DEFAULT_MVP_WEIGHTS } from "@/domain/awards/stat-awards";
import { seededRandom } from "@/domain/random";
import { demoPersonaRows } from "./demo-personas";
import type { SeedData } from "./generate";

/**
 * What the fall season's stat awards are worked out from, then the awards
 * themselves, published (ADR 0046):
 * - RSVPs for its final games: most players in, a few out, some silent.
 * - Live half-inning runs for the first three game days, adding up to
 *   each final score.
 * - Sportsmanship ratings from both captains for every final game but the
 *   first game day's, which the discipline flow rates by hand.
 * - Two approved sub spots, so Sub of the Year has a winner.
 * - Two season polls that closed the day before: the MVP vote and a
 *   best-sport vote, which the MVP and Best Teammate count.
 */
export async function addSeedStatAwards(
  db: Db,
  data: SeedData,
  now: Date,
): Promise<void> {
  const random = seededRandom(289);
  const finals = (
    await db
      .select({
        id: game.id,
        roundNo: game.roundNo,
        teamAId: game.teamAId,
        teamBId: game.teamBId,
        scoreA: game.scoreA,
        scoreB: game.scoreB,
        innings: game.inningsPlayed,
      })
      .from(game)
      .where(and(eq(game.seasonId, data.season.id), eq(game.status, "final")))
  ).sort(
    (a, b) => (a.roundNo ?? 0) - (b.roundNo ?? 0) || (a.id < b.id ? -1 : 1),
  );
  if (finals.length === 0) return;
  const rosters = await db
    .select({
      userId: registration.userId,
      teamSeasonId: rosterMembership.teamSeasonId,
      role: rosterMembership.role,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(registration.seasonId, data.season.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .orderBy(registration.userId);
  const teamOf = (teamSeasonId: string) =>
    rosters.filter((r) => r.teamSeasonId === teamSeasonId);
  const captainOf = (teamSeasonId: string) =>
    teamOf(teamSeasonId).find((r) => r.role === "captain")?.userId ?? null;
  const rounds = [...new Set(finals.map((g) => g.roundNo ?? 0))];

  const rsvps = finals.flatMap((g) =>
    [g.teamAId, g.teamBId].flatMap((teamSeasonId) =>
      teamOf(teamSeasonId).flatMap((p) => {
        const roll = random.next();
        if (roll > 0.9) return [];
        return [
          {
            gameId: g.id,
            userId: p.userId,
            teamSeasonId,
            status: roll < 0.62 ? ("in" as const) : ("out" as const),
          },
        ];
      }),
    ),
  );
  if (rsvps.length)
    await db.insert(gameRsvp).values(rsvps).onConflictDoNothing();

  // Runs spread over the innings so each half-inning adds to the score.
  const spread = (runs: number, innings: number) => {
    const out = Array.from({ length: innings }, () => 0);
    for (let r = 0; r < runs; r++) out[random.int(0, innings - 1)]! += 1;
    return out;
  };
  const live = finals.filter((g) => rounds.indexOf(g.roundNo ?? 0) < 3);
  for (const g of live) {
    const innings = g.innings ?? 5;
    const top = spread(g.scoreA ?? 0, innings);
    const bottom = spread(g.scoreB ?? 0, innings);
    await db
      .update(game)
      .set({ kicksFirst: g.teamAId })
      .where(eq(game.id, g.id));
    await db.insert(gamePeriod).values(
      top.flatMap((runs, i) => [
        { gameId: g.id, periodNo: i + 1, half: "top" as const, runs },
        {
          gameId: g.id,
          periodNo: i + 1,
          half: "bottom" as const,
          runs: bottom[i] ?? 0,
        },
      ]),
    );
  }

  const ratings = finals
    .filter((g) => (g.roundNo ?? 0) !== rounds[0])
    .flatMap((g) =>
      [
        [g.teamAId, g.teamBId],
        [g.teamBId, g.teamAId],
      ].flatMap(([by, rated]) => {
        const captain = by ? captainOf(by) : null;
        return captain && by && rated
          ? [
              {
                gameId: g.id,
                teamSeasonId: by,
                ratedTeamSeasonId: rated,
                score: random.int(3, 5),
                ratedBy: captain,
              },
            ]
          : [];
      }),
    );
  if (ratings.length)
    await db.insert(sportsmanshipRating).values(ratings).onConflictDoNothing();

  // Two players sub for the other team in the last final game.
  const last = finals.at(-1);
  if (last) {
    const subs = teamOf(last.teamAId)
      .filter((p) => p.role === "player")
      .slice(0, 2);
    const [request] = await db
      .insert(subRequest)
      .values({
        gameId: last.id,
        teamSeasonId: last.teamBId,
        requestedBy: captainOf(last.teamBId),
        needed: Math.max(1, subs.length),
        status: "filled",
        closesAt: now,
      })
      .returning({ id: subRequest.id });
    if (request && subs.length)
      await db.insert(subClaim).values(
        subs.map((p) => ({
          subRequestId: request.id,
          userId: p.userId,
          status: "approved" as const,
          decidedAt: now,
        })),
      );
  }

  // Two season polls that closed yesterday: the MVP vote, and a best-sport
  // vote for the first half. A handful of standouts draw most votes.
  const closedAt = new Date(now.getTime() - 86_400_000);
  const [mvpPoll, sportPoll] = await db
    .insert(awardPoll)
    .values(
      [
        { category: "mvp" as const, title: `${data.season.name} MVP` },
        {
          category: "best_sport" as const,
          title: `${data.season.name} Best sport, first half`,
        },
      ].map((p) => ({
        ...p,
        seasonId: data.season.id,
        kind: "season" as const,
        opensAt: new Date(closedAt.getTime() - 7 * 86_400_000),
        closesAt: closedAt,
      })),
    )
    .returning({ id: awardPoll.id });
  const stars = random.shuffle(rosters).slice(0, 6);
  const votes = [mvpPoll, sportPoll].flatMap((poll, n) =>
    poll
      ? rosters.flatMap((voter) => {
          if (random.next() > 0.65) return [];
          const choices = stars
            .slice(n * 2)
            .filter((s) => s.userId !== voter.userId);
          const pick = choices[Math.min(random.int(0, 4), choices.length - 1)];
          return pick
            ? [
                {
                  awardPollId: poll.id,
                  voterId: voter.userId,
                  nomineeUserId: pick.userId,
                  castAt: new Date(
                    closedAt.getTime() - random.int(1, 100) * 60_000,
                  ),
                },
              ]
            : [];
        })
      : [],
  );
  if (votes.length) await db.insert(awardVote).values(votes);

  const admin = demoPersonaRows(data).profiles.find(
    (p) => p.globalRole === "admin",
  )?.userId;
  if (!admin) throw new Error("The seed has no admin persona");
  const computed = await computeStatAwards(db, {
    seasonId: data.season.id,
    weights: DEFAULT_MVP_WEIGHTS,
    actorId: admin,
    now,
  });
  if (!computed.ok) throw new Error(`Stat awards: ${computed.error}`);
  await setStatAwardsPublished(db, {
    seasonId: data.season.id,
    publish: true,
    actorId: admin,
    now,
  });
}
