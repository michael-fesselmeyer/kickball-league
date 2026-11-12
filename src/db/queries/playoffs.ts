import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type {
  BracketId,
  BracketMatchId,
  GameId,
  ScheduleVersionId,
  SeasonId,
  SlotId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  advance,
  defaultPlayoffTeams,
  gameWinner,
  isReady,
  MAX_PLAYOFF_TEAMS,
  matchesFrom,
  type MatchState,
  MIN_PLAYOFF_TEAMS,
  roundCount,
} from "@/domain/playoffs/playoffs";
import { err, ok, type Result } from "@/domain/result";
import { placeBracket } from "@/domain/scheduler/bracket";
import { localDate } from "@/domain/scheduler/slots";
import type { Slot as SchedulerSlot } from "@/domain/scheduler/types";
import { field, game, slot } from "../schema/game";
import { league } from "../schema/league";
import { bracket, bracketMatch } from "../schema/playoffs";
import { scheduleVersion } from "../schema/schedule";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { required } from "./rows";
import {
  type Db,
  loadVersion,
  type PlayoffPlacement,
  publishVersion,
  saveVersion,
} from "./schedule";
import { seasonStandings } from "./standings";

/**
 * Playoffs (roadmap section 4, milestone 1). An admin seeds a bracket from
 * the final standings and places it on the season's open slots; it is saved
 * as a schedule version and published like the regular season. As playoff
 * scores become final, winners move on, and each game whose two teams are
 * now known is put on the schedule in its reserved slot by a new published
 * version.
 */

/** Teams still in the season; the same teams the scheduler plays. */
const PLAYING = ["forming", "pending_payment", "confirmed"] as const;

async function seasonZone(db: Db, seasonId: SeasonId) {
  const [found] = await db
    .select({ status: season.status, timeZone: league.timezone })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(season.id, seasonId));
  return found ?? null;
}

async function publishedVersionId(db: Db, seasonId: SeasonId) {
  const [found] = await db
    .select({ id: scheduleVersion.id })
    .from(scheduleVersion)
    .where(
      and(
        eq(scheduleVersion.seasonId, seasonId),
        eq(scheduleVersion.status, "published"),
      ),
    );
  return found?.id ?? null;
}

/** Slots a game holds in the published schedule. */
async function takenSlots(db: Db, seasonId: SeasonId): Promise<Set<string>> {
  const held = await db
    .select({ id: game.slotId })
    .from(game)
    .where(and(eq(game.seasonId, seasonId), isNotNull(game.slotId)));
  return new Set(held.flatMap((r) => (r.id ? [r.id] : [])));
}

/** Open, unused slots by local date, for choosing the playoff date. */
async function freeSlots(
  db: Db,
  seasonId: SeasonId,
  timeZone: string,
): Promise<SchedulerSlot[]> {
  const taken = await takenSlots(db, seasonId);
  const rows = await db
    .select()
    .from(slot)
    .where(and(eq(slot.seasonId, seasonId), eq(slot.status, "open")))
    .orderBy(asc(slot.startsAt), asc(slot.fieldId));
  return rows
    .filter((s) => !taken.has(s.id))
    .map((s) => ({
      id: s.id,
      fieldId: s.fieldId,
      date: localDate(s.startsAt, timeZone),
      timeIndex: s.timeIndex,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      kind: s.kind,
    }));
}

export type PlayoffPreview = {
  /** Teams in standings order; `eligible` is false for teams that left. */
  standings: {
    teamId: TeamSeasonId;
    rank: number;
    name: string;
    wins: number;
    losses: number;
    ties: number;
    eligible: boolean;
  }[];
  eligibleCount: number;
  defaultTeams: number;
  /** Dates with free slots after the last regular-season game, earliest first. */
  dates: { date: string; free: number }[];
  hasPublishedSchedule: boolean;
};

/** What the admin sees before seeding: standings, and dates to play on. */
export async function playoffPreview(
  db: Db,
  seasonId: SeasonId,
): Promise<PlayoffPreview | null> {
  const settings = await seasonZone(db, seasonId);
  if (!settings) return null;
  const { rows, teams } = await seasonStandings(db, seasonId);
  const playing = new Set(
    (
      await db
        .select({ id: teamSeason.id })
        .from(teamSeason)
        .where(
          and(
            eq(teamSeason.seasonId, seasonId),
            inArray(teamSeason.status, [...PLAYING]),
          ),
        )
    ).map((t) => t.id as string),
  );
  const standings = rows.map((r) => ({
    teamId: r.teamId as TeamSeasonId,
    rank: r.rank,
    name: teams.get(r.teamId)?.name ?? "Team",
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    eligible: playing.has(r.teamId),
  }));
  const eligibleCount = standings.filter((s) => s.eligible).length;

  const [last] = await db
    .select({ startsAt: slot.startsAt })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(and(eq(game.seasonId, seasonId), eq(game.kind, "regular")))
    .orderBy(desc(slot.startsAt))
    .limit(1);
  const lastDate = last ? localDate(last.startsAt, settings.timeZone) : "";
  const counts = new Map<string, number>();
  for (const s of await freeSlots(db, seasonId, settings.timeZone))
    if (s.date > lastDate) counts.set(s.date, (counts.get(s.date) ?? 0) + 1);

  return {
    standings,
    eligibleCount,
    defaultTeams: defaultPlayoffTeams(eligibleCount),
    dates: [...counts].map(([date, free]) => ({ date, free })),
    hasPublishedSchedule: (await publishedVersionId(db, seasonId)) !== null,
  };
}

export type CreateBracketError =
  | "unknown_season"
  | "no_schedule"
  | "already_published"
  | "too_few_teams"
  | "no_slots";

/**
 * Seeds a bracket from the standings and places it on the free slots from
 * `fromDate` on, saved as a draft schedule version built on the published
 * one. A draft bracket made earlier is replaced; a published one is kept.
 */
export async function createBracket(
  db: Db,
  input: {
    seasonId: SeasonId;
    teams: number;
    fromDate: string;
    actorId: UserId;
  },
): Promise<Result<BracketId, CreateBracketError>> {
  return db.transaction(async (tx) => {
    const settings = await seasonZone(tx, input.seasonId);
    if (!settings) return err("unknown_season");
    const [old] = await tx
      .select()
      .from(bracket)
      .where(eq(bracket.seasonId, input.seasonId))
      .for("update");
    if (old && old.status !== "draft") return err("already_published");

    const publishedId = await publishedVersionId(tx, input.seasonId);
    if (!publishedId) return err("no_schedule");
    const published = required(
      await loadVersion(tx, publishedId),
      "published version",
    );

    const preview = required(
      await playoffPreview(tx, input.seasonId),
      "preview",
    );
    const count = Math.min(input.teams, MAX_PLAYOFF_TEAMS);
    if (count < MIN_PLAYOFF_TEAMS || count > preview.eligibleCount)
      return err("too_few_teams");
    const seeds = preview.standings
      .filter((s) => s.eligible)
      .slice(0, count)
      .map((s) => s.teamId);

    const free = (
      await freeSlots(tx, input.seasonId, settings.timeZone)
    ).filter((s) => s.date >= input.fromDate);
    if (free.length === 0) return err("no_slots");
    // Every check has passed: only now replace an earlier draft.
    if (old) await discardDraft(tx, old.id, old.scheduleVersionId);
    const placed = placeBracket(seeds, free);
    const matches = matchesFrom(placed);

    const [created] = await tx
      .insert(bracket)
      .values({
        seasonId: input.seasonId,
        size: seeds.length,
        seeds: seeds.map((teamSeasonId, i) => ({ seed: i + 1, teamSeasonId })),
        diagnostics: placed.diagnostics,
        createdBy: input.actorId,
      })
      .returning({ id: bracket.id });
    const bracketId = required(created, "bracket").id;
    const slotOf = new Map(placed.matches.map((m) => [m.id, m.slotId]));
    const rows = await tx
      .insert(bracketMatch)
      .values(
        matches.map((m) => ({
          bracketId,
          code: m.code,
          roundNo: m.round,
          position: m.position,
          sourceA: m.sourceA,
          sourceB: m.sourceB,
          teamAId: m.teamA as TeamSeasonId | null,
          teamBId: m.teamB as TeamSeasonId | null,
          slotId: (slotOf.get(m.code) ?? null) as SlotId | null,
        })),
      )
      .returning({
        id: bracketMatch.id,
        code: bracketMatch.code,
        slotId: bracketMatch.slotId,
      });

    // Reserved slots become playoff slots, which rain-out makeups and new
    // regular-season schedules leave alone.
    const reserved = rows.flatMap((r) => (r.slotId ? [r.slotId] : []));
    if (reserved.length > 0)
      await tx
        .update(slot)
        .set({ kind: "playoff" })
        .where(inArray(slot.id, reserved));
    await tx
      .update(teamSeason)
      .set({ seed: null })
      .where(eq(teamSeason.seasonId, input.seasonId));
    for (const [i, id] of seeds.entries())
      await tx
        .update(teamSeason)
        .set({ seed: i + 1 })
        .where(eq(teamSeason.id, id));

    const placements: PlayoffPlacement[] = [];
    for (const m of matches.filter(isReady)) {
      const row = required(
        rows.find((r) => r.code === m.code),
        "match",
      );
      const gameId = await createGame(
        tx,
        input.seasonId,
        row.id,
        m,
        input.actorId,
      );
      placements.push({ gameId, slotId: row.slotId });
    }
    const versionId = await saveVersion(tx, {
      seasonId: input.seasonId,
      input: published.input,
      schedule: published.schedule,
      origin: "playoffs",
      parentVersionId: published.id,
      createdBy: input.actorId,
      playoffs: [...published.playoffs, ...placements],
    });
    await tx
      .update(bracket)
      .set({ scheduleVersionId: versionId })
      .where(eq(bracket.id, bracketId));
    await recordAudit(tx, {
      actorId: input.actorId,
      action: "bracket.create",
      entityType: "bracket",
      entityId: bracketId,
      after: {
        teams: seeds.length,
        rounds: roundCount(seeds.length),
        scheduleVersionId: versionId,
        unplaced: placed.matches.filter((m) => m.slotId === null).length,
      },
    });
    return ok(bracketId);
  });
}

/** Removes a draft bracket, its games and its unpublished version. */
async function discardDraft(
  db: Db,
  bracketId: BracketId,
  versionId: ScheduleVersionId | null,
) {
  const matches = await db
    .select({ gameId: bracketMatch.gameId, slotId: bracketMatch.slotId })
    .from(bracketMatch)
    .where(eq(bracketMatch.bracketId, bracketId));
  await db.delete(bracket).where(eq(bracket.id, bracketId));
  const games = matches.flatMap((m) => (m.gameId ? [m.gameId] : []));
  if (games.length > 0) await db.delete(game).where(inArray(game.id, games));
  const slots = matches.flatMap((m) => (m.slotId ? [m.slotId] : []));
  if (slots.length > 0)
    await db
      .update(slot)
      .set({ kind: "regular" })
      .where(inArray(slot.id, slots));
  if (versionId)
    await db
      .delete(scheduleVersion)
      .where(
        and(
          eq(scheduleVersion.id, versionId),
          eq(scheduleVersion.status, "draft"),
        ),
      );
}

/** Creates a match's game once both its teams are known. */
async function createGame(
  db: Db,
  seasonId: SeasonId,
  matchId: BracketMatchId,
  m: MatchState,
  createdBy: UserId | null,
): Promise<GameId> {
  const [created] = await db
    .insert(game)
    .values({
      seasonId,
      kind: "playoff",
      teamAId: m.teamA as TeamSeasonId,
      teamBId: m.teamB as TeamSeasonId,
      createdBy,
    })
    .returning({ id: game.id });
  const gameId = required(created, "playoff game").id;
  await db
    .update(bracketMatch)
    .set({ gameId })
    .where(eq(bracketMatch.id, matchId));
  return gameId;
}

export type PublishBracketError =
  "no_bracket" | "already_published" | "stale" | "has_violations";

/**
 * Publishes a draft bracket's schedule version and moves the season into
 * playoffs. A bracket drafted before another version was published is
 * stale: publishing it would undo that change, so it must be made again.
 */
export async function publishBracket(
  db: Db,
  seasonId: SeasonId,
  actorId: UserId,
  now: Date = new Date(),
): Promise<Result<BracketId, PublishBracketError>> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(bracket)
      .where(eq(bracket.seasonId, seasonId))
      .for("update");
    if (!found?.scheduleVersionId) return err("no_bracket");
    if (found.status !== "draft") return err("already_published");
    const [version] = await tx
      .select({ parent: scheduleVersion.parentVersionId })
      .from(scheduleVersion)
      .where(eq(scheduleVersion.id, found.scheduleVersionId));
    if (version?.parent !== (await publishedVersionId(tx, seasonId)))
      return err("stale");
    const published = await publishVersion(
      tx,
      found.scheduleVersionId,
      actorId,
      now,
    );
    if (!published.ok)
      return err(
        published.error === "has_violations" ? "has_violations" : "stale",
      );
    await tx
      .update(bracket)
      .set({ status: "published" })
      .where(eq(bracket.id, found.id));
    await tx
      .update(season)
      .set({ status: "playoffs" })
      .where(
        and(
          eq(season.id, seasonId),
          inArray(season.status, ["registration_closed", "in_progress"]),
        ),
      );
    await recordAudit(tx, {
      actorId,
      action: "bracket.publish",
      entityType: "bracket",
      entityId: found.id,
      after: { scheduleVersionId: found.scheduleVersionId },
    });
    return ok(found.id);
  });
}

async function matchStates(db: Db, bracketId: BracketId) {
  const rows = await db
    .select()
    .from(bracketMatch)
    .where(eq(bracketMatch.bracketId, bracketId))
    .orderBy(asc(bracketMatch.roundNo), asc(bracketMatch.position));
  const states: MatchState[] = rows.map((r) => ({
    code: r.code,
    round: r.roundNo,
    position: r.position,
    sourceA: r.sourceA,
    sourceB: r.sourceB,
    teamA: r.teamAId,
    teamB: r.teamBId,
    winner: r.winnerId,
  }));
  return { rows, states };
}

export type Advanced =
  | { kind: "not_playoff" }
  | { kind: "no_winner" }
  | { kind: "unchanged" }
  | {
      kind: "advanced";
      winner: TeamSeasonId;
      /** The game created for the next match, now on the schedule. */
      scheduled: GameId | null;
      champion: TeamSeasonId | null;
      /** The next match was already played, so the change stopped there. */
      conflict: boolean;
    };

/**
 * Moves a finished playoff game's winner on. Safe to call any number of
 * times: an unchanged result does nothing. When the next match now has both
 * teams, its game is created and published in the slot the bracket
 * reserved for it. A corrected result swaps the team in the next game while
 * that game is still to be played; after that, it is audited for an admin.
 */
export async function advanceBracket(
  db: Db,
  gameId: GameId,
  now: Date,
): Promise<Advanced> {
  const [found] = await db
    .select({
      matchId: bracketMatch.id,
      code: bracketMatch.code,
      bracketId: bracketMatch.bracketId,
      seasonId: bracket.seasonId,
      status: game.status,
      teamA: game.teamAId,
      teamB: game.teamBId,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      forfeitBy: game.forfeitBy,
    })
    .from(bracketMatch)
    .innerJoin(bracket, eq(bracketMatch.bracketId, bracket.id))
    .innerJoin(game, eq(bracketMatch.gameId, game.id))
    .where(eq(bracketMatch.gameId, gameId));
  if (!found) return { kind: "not_playoff" };
  const winner = gameWinner(found) as TeamSeasonId | null;
  if (!winner) return { kind: "no_winner" };

  const { rows, states } = await matchStates(db, found.bracketId);
  const before = states.find((m) => m.code === found.code);
  const result = advance(states, found.code, winner);
  if (before?.winner === winner && !result.moved && !result.champion)
    return { kind: "unchanged" };

  await db
    .update(bracketMatch)
    .set({ winnerId: winner })
    .where(eq(bracketMatch.id, found.matchId));

  let scheduled: GameId | null = null;
  let conflict = false;
  if (result.moved) {
    const { code, side } = result.moved;
    const to = result.moved.to as TeamSeasonId | null;
    const row = required(
      rows.find((r) => r.code === code),
      "next match",
    );
    await db
      .update(bracketMatch)
      .set(side === "A" ? { teamAId: to } : { teamBId: to })
      .where(eq(bracketMatch.id, row.id));
    const next = required(
      result.matches.find((m) => m.code === code),
      "next match",
    );
    if (row.gameId) {
      const [nextGame] = await db
        .select({ status: game.status })
        .from(game)
        .where(eq(game.id, row.gameId));
      if (nextGame?.status === "scheduled" && to)
        await db
          .update(game)
          .set(side === "A" ? { teamAId: to } : { teamBId: to })
          .where(eq(game.id, row.gameId));
      else conflict = true;
    } else if (isReady(next)) {
      scheduled = await createGame(db, found.seasonId, row.id, next, null);
      await scheduleGame(db, found.seasonId, scheduled, row.slotId, now);
    }
  }

  const champion = result.champion as TeamSeasonId | null;
  if (champion)
    await db
      .update(bracket)
      .set({ status: "complete", championId: champion })
      .where(eq(bracket.id, found.bracketId));
  await recordAudit(db, {
    actorId: null,
    action: conflict ? "bracket.advance_conflict" : "bracket.advance",
    entityType: "bracket",
    entityId: found.bracketId,
    before: { match: found.code, winner: before?.winner ?? null },
    after: { match: found.code, winner, scheduled, champion },
  });
  return { kind: "advanced", winner, scheduled, champion, conflict };
}

/**
 * Puts a new playoff game on the published schedule: a new version, made
 * from the published one with this game added, published by the league.
 */
async function scheduleGame(
  db: Db,
  seasonId: SeasonId,
  gameId: GameId,
  slotId: SlotId | null,
  now: Date,
) {
  const publishedId = await publishedVersionId(db, seasonId);
  if (!publishedId) return;
  const published = required(
    await loadVersion(db, publishedId),
    "published version",
  );
  // The reserved slot, unless something else has taken it since.
  const taken = await takenSlots(db, seasonId);
  const free = slotId && !taken.has(slotId) ? slotId : null;
  const versionId = await saveVersion(db, {
    seasonId,
    input: published.input,
    schedule: published.schedule,
    origin: "playoffs",
    parentVersionId: published.id,
    playoffs: [...published.playoffs, { gameId, slotId: free }],
  });
  await publishVersion(db, versionId, null, now);
}

export type BracketView = NonNullable<Awaited<ReturnType<typeof bracketView>>>;
export type BracketViewMatch = BracketView["matches"][number];

/**
 * A bracket for display: its seeds, matches with teams, times, fields and
 * results. Drafts are shown only when asked for, which only admins do.
 */
export async function bracketView(
  db: Db,
  seasonId: SeasonId,
  { includeDraft = false }: { includeDraft?: boolean } = {},
) {
  const [found] = await db
    .select()
    .from(bracket)
    .where(eq(bracket.seasonId, seasonId));
  if (!found || (found.status === "draft" && !includeDraft)) return null;
  const entries = await db
    .select({
      id: teamSeason.id,
      name: team.name,
      slug: team.slug,
      colorHex: team.colorHex,
    })
    .from(teamSeason)
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(eq(teamSeason.seasonId, seasonId));
  const teams = new Map(entries.map((e) => [e.id as string, e]));
  const seedOf = new Map(found.seeds.map((s) => [s.teamSeasonId, s.seed]));
  const side = (id: string | null) => {
    if (!id) return null;
    const t = teams.get(id);
    return {
      id: id as TeamSeasonId,
      name: t?.name ?? "Team",
      slug: t?.slug ?? null,
      colorHex: t?.colorHex ?? null,
      seed: seedOf.get(id) ?? null,
    };
  };
  const rows = await db
    .select({
      code: bracketMatch.code,
      round: bracketMatch.roundNo,
      position: bracketMatch.position,
      sourceA: bracketMatch.sourceA,
      sourceB: bracketMatch.sourceB,
      teamAId: bracketMatch.teamAId,
      teamBId: bracketMatch.teamBId,
      winnerId: bracketMatch.winnerId,
      gameId: bracketMatch.gameId,
      gameStatus: game.status,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      // A published game's slot; the reserved one until then.
      startsAt: slot.startsAt,
      fieldName: field.name,
    })
    .from(bracketMatch)
    .leftJoin(game, eq(bracketMatch.gameId, game.id))
    .leftJoin(
      slot,
      sql`${slot.id} = coalesce(${game.slotId}, ${bracketMatch.slotId})`,
    )
    .leftJoin(field, eq(slot.fieldId, field.id))
    .where(eq(bracketMatch.bracketId, found.id))
    .orderBy(asc(bracketMatch.roundNo), asc(bracketMatch.position));
  const settings = await seasonZone(db, seasonId);
  return {
    id: found.id,
    status: found.status,
    size: found.size,
    rounds: roundCount(found.size),
    diagnostics: found.diagnostics,
    timeZone: settings?.timeZone ?? "UTC",
    champion: side(found.championId),
    seeds: found.seeds.map((s) => ({
      seed: s.seed,
      team: side(s.teamSeasonId),
    })),
    // A game keeps its match's side order, so its scores line up.
    matches: rows.map((r) => ({
      code: r.code,
      round: r.round,
      position: r.position,
      sourceA: r.sourceA,
      sourceB: r.sourceB,
      teamA: side(r.teamAId),
      teamB: side(r.teamBId),
      winnerId: r.winnerId,
      gameId: r.gameId,
      status: r.gameStatus,
      scoreA: r.scoreA,
      scoreB: r.scoreB,
      startsAt: r.startsAt,
      fieldName: r.fieldName,
    })),
  };
}
