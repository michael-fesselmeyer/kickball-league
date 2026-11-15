import {
  aliasedTable,
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { GameId, LeagueId, UserId } from "@/domain/ids";
import type { Commitment } from "@/domain/referees/assign";
import {
  canDrop,
  type CoverRef,
  whoToAsk,
  withinAskWindow,
} from "@/domain/referees/cover";
import { err, ok, type Result } from "@/domain/result";
import type { RefereeNeededPayload } from "@/emails/referee-needed";
import { field, game, refereeAssignment, slot } from "../schema/game";
import { refereeProfile } from "../schema/referees";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";
import { subGame, type SubGameInfo } from "./subs";

/**
 * Covering a game with no ref (issue #389, ADR 0054): a ref drops a game
 * with a reason, games starting within a day with no ref ask the league's
 * refs, and the first to tap "Take it" gets the game. The rules of who is
 * asked are in src/domain/referees/cover.ts.
 */

const LIVE = ["offered", "accepted"] as const;
const PLAYED = ["accepted", "completed"] as const;

type CoverGame = SubGameInfo & {
  leagueId: LeagueId;
  /** A draft season's games aren't out yet, so nobody is asked about them. */
  draft: boolean;
  fieldId: string;
  startsAt: Date;
  endsAt: Date;
  refereeId: UserId | null;
};

/** The game with what covering it needs, or null if it has no time yet. */
async function coverGame(db: Db, gameId: GameId): Promise<CoverGame | null> {
  const [about, [extra]] = await Promise.all([
    subGame(db, gameId),
    db
      .select({
        leagueId: season.leagueId,
        draft: sql<boolean>`${season.status} = 'draft'`,
        fieldId: slot.fieldId,
        refereeId: sql<UserId | null>`(
          select ${refereeAssignment.userId} from ${refereeAssignment}
          where ${refereeAssignment.gameId} = ${game.id}
            and ${refereeAssignment.status} in ('offered', 'accepted')
          limit 1
        )`,
      })
      .from(game)
      .innerJoin(season, eq(game.seasonId, season.id))
      .innerJoin(slot, eq(game.slotId, slot.id))
      .where(eq(game.id, gameId)),
  ]);
  if (!about || !extra || !about.startsAt || !about.endsAt) return null;
  return {
    ...about,
    leagueId: extra.leagueId,
    draft: extra.draft,
    fieldId: extra.fieldId,
    startsAt: about.startsAt,
    endsAt: about.endsAt,
    refereeId: extra.refereeId,
  };
}

/** The league a game belongs to, or null if there's no such game. */
export async function leagueOfGame(db: Db, gameId: GameId) {
  const [found] = await db
    .select({ leagueId: season.leagueId })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .where(eq(game.id, gameId));
  return found?.leagueId ?? null;
}

const staffable = (g: CoverGame, now: Date) =>
  !g.draft &&
  (g.status === "scheduled" || g.status === "postponed") &&
  g.startsAt > now;

/**
 * The people the league counts as refs for a game's season, with their
 * teams that season and everything else they do while the game is on:
 * the pool, and anyone who has reffed a game that season.
 */
async function refsFor(db: Db, g: CoverGame) {
  const [pool, reffed, rosters, overlapping] = await Promise.all([
    db
      .select({ userId: refereeProfile.userId })
      .from(refereeProfile)
      .where(eq(refereeProfile.leagueId, g.leagueId)),
    db
      .selectDistinct({ userId: refereeAssignment.userId })
      .from(refereeAssignment)
      .innerJoin(game, eq(refereeAssignment.gameId, game.id))
      .where(
        and(
          eq(game.seasonId, g.seasonId),
          inArray(refereeAssignment.status, [...PLAYED]),
        ),
      ),
    db
      .select({
        userId: registration.userId,
        teamSeasonId: rosterMembership.teamSeasonId,
      })
      .from(rosterMembership)
      .innerJoin(
        registration,
        eq(rosterMembership.registrationId, registration.id),
      )
      .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
      .where(
        and(
          eq(teamSeason.seasonId, g.seasonId),
          eq(rosterMembership.status, "active"),
        ),
      ),
    db
      .select({
        teamAId: game.teamAId,
        teamBId: game.teamBId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        fieldId: slot.fieldId,
        refereeId: sql<UserId | null>`(
          select ${refereeAssignment.userId} from ${refereeAssignment}
          where ${refereeAssignment.gameId} = ${game.id}
            and ${refereeAssignment.status} in ('offered', 'accepted')
          limit 1
        )`,
      })
      .from(game)
      .innerJoin(slot, eq(game.slotId, slot.id))
      .where(
        and(
          eq(game.seasonId, g.seasonId),
          ne(game.id, g.id),
          sql`${game.status} <> 'cancelled'`,
          sql`${slot.startsAt} < ${g.endsAt}`,
          sql`${slot.endsAt} > ${g.startsAt}`,
        ),
      ),
  ]);
  const ids = [...new Set([...pool, ...reffed].map((r) => r.userId))].sort();
  const refs: CoverRef<UserId>[] = ids.map((id) => ({
    id,
    teamSeasonIds: new Set(
      rosters.filter((r) => r.userId === id).map((r) => r.teamSeasonId),
    ),
  }));
  const commitments: Commitment[] = overlapping.flatMap((o) => {
    const span = {
      startsAt: o.startsAt.getTime(),
      endsAt: o.endsAt.getTime(),
      fieldId: o.fieldId,
    };
    return refs.flatMap((r) => [
      ...(o.refereeId === r.id ? [{ refId: r.id, ...span, counts: true }] : []),
      ...(r.teamSeasonIds.has(o.teamAId) || r.teamSeasonIds.has(o.teamBId)
        ? [{ refId: r.id, ...span, counts: false }]
        : []),
    ]);
  });
  return { refs, commitments };
}

const assignGame = (g: CoverGame) => ({
  id: g.id,
  startsAt: g.startsAt.getTime(),
  endsAt: g.endsAt.getTime(),
  fieldId: g.fieldId,
  teamSeasonIds: g.teamSeasonIds,
});

/**
 * Asks the league's refs to take a game that has no ref and starts within
 * a day: one urgent message each, with a "Take it" button. Nobody playing
 * or reffing then is asked, nor `exclude`. `round` names this time the
 * game needs a ref (the dropped assignment, or "unstaffed"), so asking
 * again for the same round sends nothing new, while a game that loses a
 * second ref asks again. Returns how many were asked.
 */
export async function askRefereePool(
  db: Db,
  input: {
    gameId: GameId;
    now: Date;
    round: string;
    exclude?: readonly UserId[];
    dropped?: boolean;
  },
): Promise<number> {
  const g = await coverGame(db, input.gameId);
  if (
    !g ||
    g.refereeId !== null ||
    !staffable(g, input.now) ||
    !withinAskWindow(g.startsAt, input.now)
  )
    return 0;
  const { refs, commitments } = await refsFor(db, g);
  const asked = whoToAsk({
    game: assignGame(g),
    refs,
    commitments,
    exclude: new Set(input.exclude ?? []),
  });
  const payload: RefereeNeededPayload = {
    gameId: g.id,
    seasonName: g.seasonName,
    teams: `${g.teamNames[0]} vs ${g.teamNames[1]}`,
    when: g.when,
    dropped: input.dropped ?? false,
  };
  return enqueueMessages(
    db,
    asked.map((userId) => ({
      userId,
      topic: "sub_request" as const,
      template: "referee_needed",
      payload,
      dedupeKey: `referee_needed/${g.id}/${input.round}/${userId}`,
      sendAfter: input.now,
    })),
  );
}

export type DropError = "not_yours" | "started";

/**
 * A ref drops a game they were down to ref, with a reason, until it
 * starts. The reason goes in the audit log for admins. If the game starts
 * within a day the league's refs are asked at once.
 */
export async function dropRefereeGame(
  db: Db,
  input: { gameId: GameId; userId: UserId; reason: string; now: Date },
): Promise<Result<{ asked: number }, DropError>> {
  const [mine] = await db
    .select({ id: refereeAssignment.id, startsAt: slot.startsAt })
    .from(refereeAssignment)
    .innerJoin(game, eq(refereeAssignment.gameId, game.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(
      and(
        eq(refereeAssignment.gameId, input.gameId),
        eq(refereeAssignment.userId, input.userId),
        inArray(refereeAssignment.status, [...LIVE]),
      ),
    )
    .for("update", { of: refereeAssignment });
  if (!mine) return err("not_yours");
  if (!canDrop(mine.startsAt, input.now)) return err("started");
  await db
    .update(refereeAssignment)
    .set({ status: "declined", respondedAt: input.now })
    .where(eq(refereeAssignment.id, mine.id));
  await recordAudit(db, {
    actorId: input.userId,
    action: "referee.drop",
    entityType: "game",
    entityId: input.gameId,
    after: { userId: input.userId, reason: input.reason },
  });
  const asked = await askRefereePool(db, {
    gameId: input.gameId,
    now: input.now,
    round: mine.id,
    exclude: [input.userId],
    dropped: true,
  });
  return ok({ asked });
}

export type TakeError =
  "gone" | "started" | "taken" | "not_a_ref" | "own_team" | "plays" | "busy";

/**
 * "Take it": the first ref to tap gets the game. The game row is locked
 * first, so two refs tapping at once are served one after the other and
 * the second finds it taken; the one-live-assignment index backs that up.
 * The ref must be one the league counts (in the pool, or has reffed this
 * season), and free: not playing at that time, and not reffing another
 * game then. A ref who plays for one of the game's teams is warned
 * ("own_team") and takes it only by saying so (`ownTeamOk`): their report
 * then counts as their team's, so only the other team can confirm it (#296).
 */
export async function takeRefereeGame(
  db: Db,
  input: { gameId: GameId; userId: UserId; now: Date; ownTeamOk?: boolean },
): Promise<Result<void, TakeError>> {
  await db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.id, input.gameId))
    .for("update");
  const g = await coverGame(db, input.gameId);
  if (!g) return err("gone");
  if (!staffable(g, input.now))
    return err(g.startsAt > input.now ? "gone" : "started");
  if (g.refereeId !== null) return err("taken");
  const { refs, commitments } = await refsFor(db, g);
  const me = refs.find((r) => r.id === input.userId);
  if (!me) return err("not_a_ref");
  const own = g.teamSeasonIds.some((t) => me.teamSeasonIds.has(t));
  if (own && !input.ownTeamOk) return err("own_team");
  // Having said so, they are checked only for a clash with another game.
  const checked = own ? { ...me, teamSeasonIds: new Set<string>() } : me;
  if (
    whoToAsk({ game: assignGame(g), refs: [checked], commitments }).length === 0
  )
    return err(
      commitments.some((c) => c.refId === me.id && !c.counts)
        ? "plays"
        : "busy",
    );
  const created = await db
    .insert(refereeAssignment)
    .values({
      gameId: g.id,
      userId: input.userId,
      status: "accepted",
      respondedAt: input.now,
      createdBy: input.userId,
    })
    .onConflictDoNothing()
    .returning({ id: refereeAssignment.id });
  if (created.length === 0) return err("taken");
  await recordAudit(db, {
    actorId: input.userId,
    action: "referee.take",
    entityType: "game",
    entityId: g.id,
    after: { userId: input.userId, ...(own ? { playsInGame: true } : {}) },
  });
  return ok(undefined);
}

/** A game the take page shows, and where the person stands with it. */
export async function gameToTake(
  db: Db,
  input: { gameId: GameId; userId: UserId; now: Date },
) {
  const g = await coverGame(db, input.gameId);
  if (!g) return null;
  const state =
    g.refereeId === input.userId
      ? ("yours" as const)
      : !staffable(g, input.now)
        ? ("closed" as const)
        : g.refereeId !== null
          ? ("taken" as const)
          : ("open" as const);
  // The team of this game the viewer plays for, if any: refing it is
  // allowed only after a warning (#296).
  const mine = await db
    .select({ teamSeasonId: rosterMembership.teamSeasonId })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(rosterMembership.registrationId, registration.id),
    )
    .where(
      and(
        eq(registration.userId, input.userId),
        eq(rosterMembership.status, "active"),
        inArray(rosterMembership.teamSeasonId, [...g.teamSeasonIds]),
      ),
    );
  const playsFor = g.teamSeasonIds.flatMap((t, i) =>
    mine.some((m) => m.teamSeasonId === t) ? [g.teamNames[i] ?? ""] : [],
  );
  return {
    id: g.id,
    teams: `${g.teamNames[0]} vs ${g.teamNames[1]}`,
    when: g.when,
    seasonName: g.seasonName,
    state,
    playsFor,
  };
}

const teamA = aliasedTable(team, "team_a");
const teamB = aliasedTable(team, "team_b");
const entryA = aliasedTable(teamSeason, "entry_a");
const entryB = aliasedTable(teamSeason, "entry_b");

/**
 * The league's games that start within a day and have no ref, soonest
 * first, for the command center and the daily job. One read.
 */
export async function gamesNeedingRef(
  db: Db,
  input: { leagueId: LeagueId; now: Date },
) {
  const until = new Date(input.now.getTime() + 24 * 60 * 60_000);
  return db
    .select({
      gameId: game.id,
      startsAt: slot.startsAt,
      fieldName: field.name,
      teamAName: teamA.name,
      teamBName: teamB.name,
      seasonSlug: season.slug,
    })
    .from(game)
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(entryA, eq(game.teamAId, entryA.id))
    .innerJoin(teamA, eq(entryA.teamId, teamA.id))
    .innerJoin(entryB, eq(game.teamBId, entryB.id))
    .innerJoin(teamB, eq(entryB.teamId, teamB.id))
    .leftJoin(
      refereeAssignment,
      and(
        eq(refereeAssignment.gameId, game.id),
        inArray(refereeAssignment.status, [...LIVE]),
      ),
    )
    .where(
      and(
        eq(season.leagueId, input.leagueId),
        ne(season.status, "draft"),
        inArray(game.status, ["scheduled", "postponed"]),
        eq(slot.status, "open"),
        gt(slot.startsAt, input.now),
        lte(slot.startsAt, until),
        isNull(refereeAssignment.id),
      ),
    )
    .orderBy(asc(slot.startsAt), asc(field.name));
}

/**
 * The daily job: asks the league's refs about every game starting within
 * a day that has no ref and hasn't been asked about yet. Returns how many
 * messages it queued.
 */
export async function askForUnstaffedGames(
  db: Db,
  input: { leagueId: LeagueId; now: Date },
): Promise<number> {
  const games = await gamesNeedingRef(db, input);
  let asked = 0;
  for (const g of games)
    asked += await askRefereePool(db, {
      gameId: g.gameId,
      now: input.now,
      round: "unstaffed",
    });
  return asked;
}
