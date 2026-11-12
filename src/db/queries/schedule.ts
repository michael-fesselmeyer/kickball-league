import { and, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
  GameId,
  ScheduleVersionId,
  SeasonId,
  SlotId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { diffSchedules, type ScheduleDiff } from "@/domain/scheduler/diff";
import { measure } from "@/domain/scheduler/measure";
import { localDate } from "@/domain/scheduler/slots";
import {
  DEFAULT_WEIGHTS,
  gameKey,
  type ScheduledGame,
  type Schedule,
  type SchedulerInput,
  type TeamConstraint,
  type Weights,
} from "@/domain/scheduler/types";
import { validate } from "@/domain/scheduler/validate";
import type * as schema from "../schema";
import { game, slot } from "../schema/game";
import { league } from "../schema/league";
import {
  gamePlacement,
  scheduleVersion,
  teamConstraint,
} from "../schema/schedule";
import { season } from "../schema/season";
import { teamSeason } from "../schema/team";
import { recordAudit } from "./audit";
import { queueRainoutNotices } from "./rainout-notices";
import { required } from "./rows";

/**
 * Any Postgres database or transaction: the app passes the WebSocket driver,
 * which supports transactions, and tests pass node-postgres.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Choices the admin makes when generating; stored in each version's input. */
export type GenerateOptions = {
  rounds: number;
  reservePerDay: number;
  seed: number;
  weights?: Weights;
  locked?: SchedulerInput["locked"];
};

/** Teams that are still in the season; waitlisted and withdrawn teams are not scheduled. */
const SCHEDULED_STATUSES = ["forming", "pending_payment", "confirmed"] as const;

/**
 * Builds the scheduler's input for a season from the database: its teams,
 * open slots (dated in the league's time zone), team constraints and
 * settings, plus the admin's choices.
 */
export async function loadSchedulerInput(
  db: Db,
  seasonId: SeasonId,
  options: GenerateOptions,
): Promise<Result<SchedulerInput, "unknown_season">> {
  const [settings] = await db
    .select({
      gamesPerTeamPerDay: season.gamesPerTeamPerDay,
      timeZone: league.timezone,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(eq(season.id, seasonId));
  if (!settings) return err("unknown_season");

  const teams = await db
    .select({ id: teamSeason.id })
    .from(teamSeason)
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        inArray(teamSeason.status, [...SCHEDULED_STATUSES]),
      ),
    )
    .orderBy(teamSeason.id);
  const slots = await db
    .select()
    .from(slot)
    .where(and(eq(slot.seasonId, seasonId), eq(slot.status, "open")))
    .orderBy(slot.startsAt, slot.fieldId);
  const constraints = await db
    .select({
      teamId: teamConstraint.teamSeasonId,
      kind: teamConstraint.kind,
      onDate: teamConstraint.onDate,
      timeIndex: teamConstraint.timeIndex,
      weight: teamConstraint.weight,
    })
    .from(teamConstraint)
    .innerJoin(teamSeason, eq(teamConstraint.teamSeasonId, teamSeason.id))
    .where(eq(teamSeason.seasonId, seasonId))
    .orderBy(teamConstraint.id);

  return ok({
    teams: teams.map((t) => ({ id: t.id })),
    slots: slots.map((s) => ({
      id: s.id,
      fieldId: s.fieldId,
      date: localDate(s.startsAt, settings.timeZone),
      timeIndex: s.timeIndex,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      kind: s.kind,
    })),
    rounds: options.rounds,
    gamesPerTeamPerDay: settings.gamesPerTeamPerDay === 2 ? 2 : 1,
    reservePerDay: options.reservePerDay,
    constraints: constraints.map((c) => {
      const constraint: TeamConstraint = {
        teamId: c.teamId,
        kind: c.kind,
        weight: c.weight,
      };
      if (c.onDate !== null) constraint.date = c.onDate;
      if (c.timeIndex !== null) constraint.timeIndex = c.timeIndex;
      return constraint;
    }),
    locked: options.locked ?? [],
    weights: options.weights ?? DEFAULT_WEIGHTS,
    seed: options.seed,
  });
}

/**
 * Saves a schedule as a new draft version, with its input, metrics and
 * violations. Games keep one row each for the whole season, found by their
 * stable key; the version holds where each is placed.
 *
 * A rain-out version switches the season to makeup rules: makeups may give
 * a team two games on a date, and they spend the makeup reserve on purpose
 * (scheduling-algorithm.md, sections 2 and 7). The rules are stored in the
 * version's input, so edits that start from it are judged the same way,
 * while a fresh generation starts from the season's own settings.
 */
export async function saveVersion(
  db: Db,
  {
    seasonId,
    input,
    schedule,
    origin,
    parentVersionId,
    createdBy,
    playoffs,
  }: {
    seasonId: SeasonId;
    input: SchedulerInput;
    schedule: Schedule;
    origin: "generated" | "manual_edit" | "rainout" | "playoffs";
    parentVersionId?: ScheduleVersionId;
    createdBy?: UserId;
    /**
     * Where the playoff games sit. Left out, they are carried over from the
     * parent version, so editing the regular season never drops the
     * bracket; a playoff game whose slot a regular game now takes is left
     * unplaced.
     */
    playoffs?: PlayoffPlacement[];
  },
): Promise<ScheduleVersionId> {
  const rules: SchedulerInput =
    origin === "rainout"
      ? { ...input, gamesPerTeamPerDay: 2, reservePerDay: 0 }
      : input;
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ last: max(scheduleVersion.versionNo) })
      .from(scheduleVersion)
      .where(eq(scheduleVersion.seasonId, seasonId));
    const versionNo = (latest?.last ?? 0) + 1;
    const violations = validate(rules, schedule);
    const [version] = await tx
      .insert(scheduleVersion)
      .values({
        seasonId,
        versionNo,
        parentVersionId: parentVersionId ?? null,
        origin,
        seed: rules.seed,
        inputSnapshot: rules,
        metrics: measure(rules, schedule),
        violations,
        diagnostics: schedule.diagnostics,
        createdBy: createdBy ?? null,
      })
      .returning({ id: scheduleVersion.id });
    const versionId = required(version, "schedule version").id;

    // Playoff games are found through their bracket match, never by key.
    const existing = await tx
      .select({
        id: game.id,
        roundNo: game.roundNo,
        teamAId: game.teamAId,
        teamBId: game.teamBId,
      })
      .from(game)
      .where(and(eq(game.seasonId, seasonId), ne(game.kind, "playoff")));
    const byKey = new Map<string, GameId>();
    const remember = (g: (typeof existing)[number]) => {
      if (g.roundNo !== null)
        byKey.set(gameKey(g.roundNo, g.teamAId, g.teamBId), g.id);
    };
    existing.forEach(remember);
    const missing = schedule.games.filter((g) => !byKey.has(g.key));
    if (missing.length > 0) {
      const inserted = await tx
        .insert(game)
        .values(
          missing.map((g) => ({
            seasonId,
            roundNo: g.round,
            teamAId: g.teamA as TeamSeasonId,
            teamBId: g.teamB as TeamSeasonId,
            createdBy: createdBy ?? null,
          })),
        )
        .returning({
          id: game.id,
          roundNo: game.roundNo,
          teamAId: game.teamAId,
          teamBId: game.teamBId,
        });
      inserted.forEach(remember);
    }

    const pins = new Map(rules.locked.map((l) => [l.gameKey, l.slotId]));
    if (schedule.games.length > 0)
      await tx.insert(gamePlacement).values(
        schedule.games.map((g) => ({
          scheduleVersionId: versionId,
          gameId: byKey.get(g.key) as GameId,
          slotId: g.slotId as SlotId | null,
          locked: g.slotId !== null && pins.get(g.key) === g.slotId,
        })),
      );
    const taken = new Set(schedule.games.map((g) => g.slotId));
    const carried =
      playoffs ??
      (parentVersionId ? await playoffPlacements(tx, parentVersionId) : []);
    if (carried.length > 0)
      await tx.insert(gamePlacement).values(
        carried.map((p) => ({
          scheduleVersionId: versionId,
          gameId: p.gameId,
          slotId: p.slotId !== null && taken.has(p.slotId) ? null : p.slotId,
        })),
      );
    await recordAudit(tx, {
      actorId: createdBy ?? null,
      action: "schedule.save_version",
      entityType: "schedule_version",
      entityId: versionId,
      after: {
        versionNo,
        origin,
        violations: violations.length,
        unplaced: schedule.games.filter((g) => g.slotId === null).length,
      },
    });
    return versionId;
  });
}

export type StoredVersion = {
  id: ScheduleVersionId;
  seasonId: SeasonId;
  versionNo: number;
  status: "draft" | "published" | "superseded";
  input: SchedulerInput;
  /** The regular season; playoff games are in `playoffs`. */
  schedule: Schedule;
  playoffs: PlayoffPlacement[];
};

/** Where a playoff game sits in a version. */
export type PlayoffPlacement = { gameId: GameId; slotId: SlotId | null };

/** The playoff games a version places, kept apart from the round robin. */
export async function playoffPlacements(
  db: Db,
  versionId: ScheduleVersionId,
): Promise<PlayoffPlacement[]> {
  return db
    .select({ gameId: gamePlacement.gameId, slotId: gamePlacement.slotId })
    .from(gamePlacement)
    .innerJoin(game, eq(gamePlacement.gameId, game.id))
    .where(
      and(
        eq(gamePlacement.scheduleVersionId, versionId),
        eq(game.kind, "playoff"),
      ),
    )
    .orderBy(gamePlacement.gameId);
}

/**
 * Loads a version and rebuilds its schedule; byes are the teams without a
 * game in a round. Playoff games are listed apart, so the round-robin rules
 * never judge a bracket.
 */
export async function loadVersion(
  db: Db,
  versionId: ScheduleVersionId,
): Promise<StoredVersion | null> {
  const [version] = await db
    .select()
    .from(scheduleVersion)
    .where(eq(scheduleVersion.id, versionId));
  if (!version) return null;
  const rows = await db
    .select({
      round: game.roundNo,
      teamA: game.teamAId,
      teamB: game.teamBId,
      slotId: gamePlacement.slotId,
    })
    .from(gamePlacement)
    .innerJoin(game, eq(gamePlacement.gameId, game.id))
    .where(
      and(
        eq(gamePlacement.scheduleVersionId, versionId),
        ne(game.kind, "playoff"),
      ),
    );

  const input = version.inputSnapshot;
  const games = rows
    .map((r): ScheduledGame => {
      const round = r.round ?? 0;
      return {
        key: gameKey(round, r.teamA, r.teamB),
        round,
        teamA: r.teamA,
        teamB: r.teamB,
        slotId: r.slotId,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  const rounds = [...new Set(games.map((g) => g.round))].sort((a, b) => a - b);
  const byes = rounds.flatMap((round) => {
    const playing = new Set(
      games.filter((g) => g.round === round).flatMap((g) => [g.teamA, g.teamB]),
    );
    return input.teams
      .filter((t) => !playing.has(t.id))
      .map((t) => ({ round, teamId: t.id }));
  });
  return {
    id: version.id,
    seasonId: version.seasonId,
    versionNo: version.versionNo,
    status: version.status,
    input,
    schedule: {
      games,
      byes,
      unplaced: games.filter((g) => g.slotId === null).map((g) => g.key),
      diagnostics: version.diagnostics,
    },
    playoffs: await playoffPlacements(db, versionId),
  };
}

export type PublishError = "unknown_version" | "not_draft" | "has_violations";

/** What changed since the previous published version, and how many rain-out notices were queued. */
export type Published = ScheduleDiff & { notified: number };

/**
 * Publishes a draft version in one transaction: the season's published
 * version is superseded, this one is published, and every game's slot is
 * copied from this version so public pages need one join. Players whose
 * games moved out of rained-out slots are sent their makeup times through
 * the outbox, in the same transaction. Returns what changed since the
 * previous published version.
 */
export async function publishVersion(
  db: Db,
  versionId: ScheduleVersionId,
  /** Null when the league publishes on its own, as when a bracket advances. */
  publishedBy: UserId | null,
  now: Date = new Date(),
): Promise<Result<Published, PublishError>> {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select({
        seasonId: scheduleVersion.seasonId,
        status: scheduleVersion.status,
        violations: scheduleVersion.violations,
      })
      .from(scheduleVersion)
      .where(eq(scheduleVersion.id, versionId))
      .for("update");
    if (!version) return err("unknown_version");
    if (version.status !== "draft") return err("not_draft");
    if ((version.violations as unknown[]).length > 0)
      return err("has_violations");

    const [current] = await tx
      .select({ id: scheduleVersion.id })
      .from(scheduleVersion)
      .where(
        and(
          eq(scheduleVersion.seasonId, version.seasonId),
          eq(scheduleVersion.status, "published"),
        ),
      );
    const before = current ? await loadVersion(tx, current.id) : null;

    await tx
      .update(scheduleVersion)
      .set({ status: "superseded" })
      .where(
        and(
          eq(scheduleVersion.seasonId, version.seasonId),
          eq(scheduleVersion.status, "published"),
        ),
      );
    await tx
      .update(scheduleVersion)
      .set({ status: "published", publishedAt: new Date(), publishedBy })
      .where(eq(scheduleVersion.id, versionId));
    await tx.execute(sql`
      update ${game} set slot_id = ${gamePlacement.slotId}
      from ${gamePlacement}
      where ${gamePlacement.scheduleVersionId} = ${versionId}
        and ${gamePlacement.gameId} = ${game.id}`);
    await tx.execute(sql`
      update ${game} set slot_id = null
      where ${game.seasonId} = ${version.seasonId}
        and ${game.id} not in (
          select ${gamePlacement.gameId} from ${gamePlacement}
          where ${gamePlacement.scheduleVersionId} = ${versionId})`);

    const after = required(
      await loadVersion(tx, versionId),
      "published version",
    );
    const empty: Schedule = {
      games: [],
      byes: [],
      unplaced: [],
      diagnostics: [],
    };
    const diff = diffSchedules(before?.schedule ?? empty, after.schedule);
    const notified = await queueRainoutNotices(
      tx,
      version.seasonId,
      diff.moved,
      now,
    );
    await recordAudit(tx, {
      actorId: publishedBy,
      action: "schedule.publish",
      entityType: "schedule_version",
      entityId: versionId,
      before: { publishedVersionId: current?.id ?? null },
      after: {
        moved: diff.moved.length,
        added: diff.added.length,
        removed: diff.removed.length,
        teamsAffected: diff.teams.length,
        rainoutNotices: notified,
      },
    });
    return ok({ ...diff, notified });
  });
}
