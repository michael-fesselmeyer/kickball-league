import { eq } from "drizzle-orm";
import { seasonCardsFor } from "@/db/queries/season-cards";
import type { Db } from "@/db/queries/schedule";
import {
  awardPoll,
  awardVote,
  game,
  gamePeriod,
  gameRsvp,
  registration,
  rosterMembership,
  seasonCard,
} from "@/db/schema";
import type {
  AwardPollId,
  GameId,
  RegistrationId,
  RosterMembershipId,
  SeasonCardId,
  UserId,
} from "@/domain/ids";
import type { SeedData } from "./generate";
import { generatePastSeasons } from "./past-seasons";

/**
 * "Your season in kickball" for the demo: six players of one team played
 * Summer 2026 (a completed past season), so its cards can be built and
 * shown. One player answered RSVPs, one game was scored live, and the
 * season's MVP poll is closed with a winner. The cards are built here
 * without messages; the admin's "Build the cards" sends them. One card is
 * public, with a fixed id, for the public page's performance budget.
 *
 * Pure rows plus one insert function, with fixed ids, so a reseed gives
 * the same people and links.
 */

export const SEASON_CARD_SEASON = "summer-2026";

/** The public demo card (lighthouserc.json lists its page). */
export const PUBLIC_CARD_ID =
  "5ea50000-0000-4000-8000-000000000001" as SeasonCardId;

const cardRowId = <T extends string>(n: number) =>
  `5ea50000-0000-4000-8000-${String(n + 100).padStart(12, "0")}` as T;

/** The team's runs spread over seven innings, with one big inning. */
export function inningsFor(score: number): number[] {
  if (score < 6) return [0, score, 0, 0, 0, 0, 0];
  return [1, 0, 1, score - 4, 1, 0, 1];
}

export function seasonCardSeedRows(data: SeedData) {
  const past = generatePastSeasons(data);
  const summer = past.seasons.find((s) => s.season.slug === SEASON_CARD_SEASON);
  if (!summer) throw new Error("The seed has no Summer 2026");
  // The first fall team that also played the summer.
  const fall = data.teamSeasons.find((t) =>
    summer.entries.some((e) => e.teamId === t.teamId),
  );
  const entry = summer.entries.find((e) => e.teamId === fall?.teamId);
  if (!fall || !entry) throw new Error("No team played both seasons");

  // Six of the team's fall players, not its captains or the demo personas.
  const players = data.rosterMemberships
    .filter((m) => m.teamSeasonId === fall.id && m.role === "player")
    .flatMap((m) => {
      const r = data.registrations.find((x) => x.id === m.registrationId);
      return r ? [r.userId] : [];
    })
    .slice(0, 6);
  if (players.length < 4) throw new Error("The team has too few players");

  const registrations = players.map((userId, i) => ({
    id: cardRowId<RegistrationId>(i + 1),
    seasonId: summer.season.id,
    userId,
    kind: "team_member" as const,
    status: "active" as const,
  }));
  const memberships = registrations.map((r, i) => ({
    id: cardRowId<RosterMembershipId>(i + 11),
    teamSeasonId: entry.id,
    registrationId: r.id,
    role: i === 0 ? ("captain" as const) : ("player" as const),
    status: "active" as const,
    startedAt: new Date("2026-06-01T16:00:00Z"),
  }));

  const teamGames = summer.games.filter(
    (g) =>
      g.status === "final" &&
      (g.teamAId === entry.id || g.teamBId === entry.id),
  );
  // The second player said they were in for every game but the first.
  const rsvper = players[1] as UserId;
  const rsvps = teamGames.map((g, i) => ({
    gameId: g.id as GameId,
    userId: rsvper,
    teamSeasonId: entry.id,
    status: i === 0 ? ("out" as const) : ("in" as const),
  }));

  // The last game was scored live, half-inning by half-inning.
  const live = teamGames.at(-1);
  const periods = live
    ? (["top", "bottom"] as const).flatMap((half) => {
        const kicks = half === "top" ? live.teamAId : live.teamBId;
        const score = (kicks === live.teamAId ? live.scoreA : live.scoreB) ?? 0;
        return inningsFor(score).map((runs, i) => ({
          gameId: live.id as GameId,
          periodNo: i + 1,
          half,
          runs,
        }));
      })
    : [];

  // The season's MVP: the third player, with most of the team's votes.
  const mvp = players[2] as UserId;
  const lastDay = summer.season.endsOn;
  const poll = {
    id: cardRowId<AwardPollId>(21),
    seasonId: summer.season.id,
    kind: "season" as const,
    category: "mvp" as const,
    title: `${summer.season.name} MVP`,
    gameDay: null,
    opensAt: new Date(`${lastDay}T23:00:00Z`),
    closesAt: new Date(
      new Date(`${lastDay}T23:00:00Z`).getTime() + 3 * 86_400_000,
    ),
  };
  const votes = players.map((voter, i) => ({
    awardPollId: poll.id,
    voterId: voter,
    nomineeUserId: voter === mvp ? (players[0] as UserId) : mvp,
    castAt: new Date(poll.opensAt.getTime() + (i + 1) * 3_600_000),
  }));

  return {
    seasonId: summer.season.id,
    registrations,
    memberships,
    rsvps,
    kicksFirst: live ? { gameId: live.id as GameId, team: live.teamAId } : null,
    periods,
    poll,
    votes,
    /** Whose card is public on the demo. */
    publicPlayer: players[3] as UserId,
  };
}

/** Adds Summer 2026's players and builds their cards. */
export async function addSeasonCards(
  db: Db,
  data: SeedData,
  now: Date,
): Promise<void> {
  const rows = seasonCardSeedRows(data);
  await db.insert(registration).values(rows.registrations);
  await db.insert(rosterMembership).values(rows.memberships);
  if (rows.rsvps.length > 0) await db.insert(gameRsvp).values(rows.rsvps);
  if (rows.kicksFirst) {
    await db
      .update(game)
      .set({ kicksFirst: rows.kicksFirst.team })
      .where(eq(game.id, rows.kicksFirst.gameId));
    await db.insert(gamePeriod).values(rows.periods);
  }
  await db.insert(awardPoll).values(rows.poll);
  await db.insert(awardVote).values(rows.votes);
  const cards = await seasonCardsFor(db, rows.seasonId, now);
  if (cards.length > 0)
    await db.insert(seasonCard).values(
      cards.map((c) => ({
        ...(c.userId === rows.publicPlayer ? { id: PUBLIC_CARD_ID } : {}),
        seasonId: rows.seasonId,
        userId: c.userId,
        stats: c.stats,
        isPublic: c.userId === rows.publicPlayer,
        builtAt: now,
      })),
    );
}
