import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type {
  BracketId,
  BracketMatchId,
  DivisionId,
  GameId,
  ScheduleVersionId,
  SeasonId,
  SlotId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  advance,
  type BracketFormat,
  decidesTitle,
  defaultPlayoffTeams,
  divisionHalvesSeeds,
  gameNumbers,
  gameWinner,
  isReady,
  MAX_PLAYOFF_TEAMS,
  MAX_TIERS,
  matchesFrom,
  type MatchState,
  MIN_PLAYOFF_TEAMS,
  roundCount,
  splitTiers,
} from "@/domain/playoffs/playoffs";
import { err, ok, type Result } from "@/domain/result";
import { placeBracket } from "@/domain/scheduler/bracket";
import { localDate } from "@/domain/scheduler/slots";
import type { Slot as SchedulerSlot } from "@/domain/scheduler/types";
import { division } from "../schema/division";
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
  lockSchedulePublish,
  publishVersion,
  saveVersion,
} from "./schedule";
import { seasonDivisionStandings, seasonStandings } from "./standings";

/** Teams each division sends by default when the season has divisions. */
const DEFAULT_DIVISION_PLAYOFF_TEAMS = 4;

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
    .select({
      status: season.status,
      timeZone: league.timezone,
      combinedFinal: season.combinedFinal,
    })
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

/** One team's line on the seeding table. */
export type SeedingRow = {
  teamId: TeamSeasonId;
  rank: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  eligible: boolean;
};

/**
 * How a season's playoffs are seeded (ADR 0040): one bracket from the
 * season table; two divisions in opposite halves of one bracket, meeting
 * in a combined final; or a bracket per division.
 */
export type PlayoffMode = "single" | "halves" | "per_division";

export type PlayoffPreview = {
  mode: PlayoffMode;
  /** Teams in standings order; `eligible` is false for teams that left. */
  standings: SeedingRow[];
  /**
   * With divisions, each division's table; teams not in a division cannot
   * be seeded. Empty for a season without divisions.
   */
  divisions: { id: DivisionId; name: string; standings: SeedingRow[] }[];
  /** Most teams that can make it: per division when there are divisions. */
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
  const [{ rows, teams }, divided, entries] = await Promise.all([
    seasonStandings(db, seasonId),
    seasonDivisionStandings(db, seasonId),
    db
      .select({ id: teamSeason.id })
      .from(teamSeason)
      .where(
        and(
          eq(teamSeason.seasonId, seasonId),
          inArray(teamSeason.status, [...PLAYING]),
        ),
      ),
  ]);
  const playing = new Set(entries.map((t) => t.id as string));
  const seeding = (
    table: readonly {
      teamId: string;
      rank: number;
      wins: number;
      losses: number;
      ties: number;
    }[],
  ): SeedingRow[] =>
    table.map((r) => ({
      teamId: r.teamId as TeamSeasonId,
      rank: r.rank,
      name: teams.get(r.teamId)?.name ?? "Team",
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      eligible: playing.has(r.teamId),
    }));
  const standings = seeding(rows);
  const divisions = divided.tables.flatMap((t) =>
    t.division
      ? [
          {
            id: t.division.id,
            name: t.division.name,
            standings: seeding(t.rows),
          },
        ]
      : [],
  );
  const mode: PlayoffMode =
    divisions.length === 0
      ? "single"
      : divisions.length === 2 && settings.combinedFinal
        ? "halves"
        : "per_division";
  const eligibleCount =
    mode === "single"
      ? standings.filter((s) => s.eligible).length
      : Math.min(
          ...divisions.map((d) => d.standings.filter((s) => s.eligible).length),
        );

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
    mode,
    standings,
    divisions,
    eligibleCount,
    defaultTeams:
      mode === "single"
        ? defaultPlayoffTeams(eligibleCount)
        : Math.min(DEFAULT_DIVISION_PLAYOFF_TEAMS, eligibleCount),
    dates: [...counts].map(([date, free]) => ({ date, free })),
    hasPublishedSchedule: (await publishedVersionId(db, seasonId)) !== null,
  };
}

export type CreateBracketError =
  | "unknown_season"
  | "no_schedule"
  | "already_published"
  | "too_few_teams"
  | "no_slots"
  | "bad_innings"
  | "tiers_with_divisions";

/**
 * One bracket's settings: how many teams, from which playoff day, single
 * or double elimination, a third-place game (single elimination only) and
 * the innings for early games and for the title games.
 */
export type TierPlan = {
  teams: number;
  fromDate: string;
  format?: BracketFormat;
  thirdPlace?: boolean;
  /** Null or missing for the league's usual innings. */
  earlyInnings?: number | null;
  finalInnings?: number | null;
};

const MIN_INNINGS = 1;
const MAX_INNINGS = 15;
const inningsOk = (n: number | null | undefined) =>
  n === null ||
  n === undefined ||
  (Number.isInteger(n) && n >= MIN_INNINGS && n <= MAX_INNINGS);

/**
 * Seeds the playoffs from the standings and places them on the free slots
 * from `fromDate` on, saved as one draft schedule version built on the
 * published one. `teams` is the number of teams that make it, per division
 * when the season has divisions: two divisions with a combined final share
 * one bracket, each in its own half; otherwise each division gets its own
 * bracket, placed one after another on the free slots.
 *
 * Without divisions, `tiers` can split the standings into up to three
 * brackets (ADR 0064): the first tier's teams from the top, the next
 * tier's from the places after, each with its own format and day. The
 * top-level settings are the first tier when `tiers` is not given. Drafts
 * made earlier are replaced; a published bracket is kept.
 */
export async function createBracket(
  db: Db,
  input: TierPlan & {
    seasonId: SeasonId;
    actorId: UserId;
    tiers?: readonly TierPlan[];
  },
): Promise<Result<BracketId, CreateBracketError>> {
  const tiers: TierPlan[] = input.tiers ? [...input.tiers] : [input];
  return db.transaction(async (tx) => {
    const settings = await seasonZone(tx, input.seasonId);
    if (!settings) return err("unknown_season");
    const old = await tx
      .select()
      .from(bracket)
      .where(eq(bracket.seasonId, input.seasonId))
      .for("update");
    if (old.some((b) => b.status !== "draft")) return err("already_published");

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
    const top = (rows: readonly SeedingRow[], n: number) =>
      rows
        .filter((s) => s.eligible)
        .slice(0, n)
        .map((s) => s.teamId as string);
    const [firstTier] = tiers;
    if (!firstTier || tiers.length > MAX_TIERS) return err("too_few_teams");
    if (tiers.length > 1 && preview.mode !== "single")
      return err("tiers_with_divisions");
    if (
      tiers.some(
        (t) => !inningsOk(t.earlyInnings) || !inningsOk(t.finalInnings),
      )
    )
      return err("bad_innings");
    const n = firstTier.teams;
    const lowest = preview.mode === "halves" ? 1 : MIN_PLAYOFF_TEAMS;
    const highest =
      preview.mode === "halves" ? MAX_PLAYOFF_TEAMS / 2 : MAX_PLAYOFF_TEAMS;
    if (n < lowest || n > Math.min(highest, preview.eligibleCount))
      return err("too_few_teams");
    const [first, second] = preview.divisions;
    type Planned = {
      divisionId: DivisionId | null;
      seeds: string[];
      tier: number;
      plan: TierPlan;
      /** Seeds before this bracket's in the season's order. */
      offset: number;
    };
    let planned: Planned[];
    if (preview.mode === "single") {
      const split = splitTiers(
        top(preview.standings, MAX_PLAYOFF_TEAMS * MAX_TIERS),
        tiers.map((t) => t.teams),
      );
      if (!split) return err("too_few_teams");
      let offset = 0;
      planned = split.map((seeds, i) => {
        const p = {
          divisionId: null,
          seeds,
          tier: i + 1,
          plan: tiers[i] as TierPlan,
          offset,
        };
        offset += seeds.length;
        return p;
      });
    } else
      planned =
        preview.mode === "halves" && first && second
          ? [
              {
                divisionId: null,
                seeds: required(
                  divisionHalvesSeeds(
                    top(first.standings, n),
                    top(second.standings, n),
                  ),
                  "halves",
                ),
                tier: 1,
                plan: firstTier,
                offset: 0,
              },
            ]
          : preview.divisions.map((d) => ({
              divisionId: d.id,
              seeds: top(d.standings, n),
              tier: 1,
              plan: firstTier,
              offset: 0,
            }));

    let free = await freeSlots(tx, input.seasonId, settings.timeZone);
    if (tiers.some((t) => !free.some((s) => s.date >= t.fromDate)))
      return err("no_slots");
    // Every check has passed: only now replace earlier drafts.
    for (const o of old) await discardDraft(tx, o.id, o.scheduleVersionId);
    await tx
      .update(teamSeason)
      .set({ seed: null })
      .where(eq(teamSeason.seasonId, input.seasonId));

    const created: BracketId[] = [];
    const placements: PlayoffPlacement[] = [];
    for (const p of planned) {
      const format = p.plan.format ?? "single_elimination";
      const thirdPlace =
        format === "single_elimination" && (p.plan.thirdPlace ?? false);
      const placed = placeBracket(
        p.seeds,
        free.filter((s) => s.date >= p.plan.fromDate),
        { format, thirdPlace },
      );
      // The next bracket takes the slots this one leaves.
      const used = new Set(placed.matches.map((m) => m.slotId));
      free = free.filter((s) => !used.has(s.id));
      const { bracketId, games } = await saveBracket(tx, {
        seasonId: input.seasonId,
        divisionId: p.divisionId,
        tier: p.tier,
        format,
        thirdPlace,
        earlyInnings: p.plan.earlyInnings ?? null,
        finalInnings: p.plan.finalInnings ?? null,
        seedOffset: p.offset,
        seeds: p.seeds,
        placed,
        actorId: input.actorId,
      });
      created.push(bracketId);
      placements.push(...games);
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
      .where(inArray(bracket.id, created));
    return ok(required(created[0], "bracket"));
  });
}

/**
 * Saves one placed bracket: its row, its matches, its reserved slots, its
 * seeds, and a game for each match whose teams are already known.
 */
async function saveBracket(
  tx: Db,
  input: {
    seasonId: SeasonId;
    divisionId: DivisionId | null;
    tier: number;
    format: BracketFormat;
    thirdPlace: boolean;
    earlyInnings: number | null;
    finalInnings: number | null;
    /** Teams seeded in brackets before this one, for each team's season seed. */
    seedOffset: number;
    seeds: readonly string[];
    placed: ReturnType<typeof placeBracket>;
    actorId: UserId;
  },
): Promise<{ bracketId: BracketId; games: PlayoffPlacement[] }> {
  const { placed, seeds } = input;
  const matches = matchesFrom(placed);
  const [created] = await tx
    .insert(bracket)
    .values({
      seasonId: input.seasonId,
      divisionId: input.divisionId,
      tier: input.tier,
      format: input.format,
      thirdPlace: input.thirdPlace,
      earlyInnings: input.earlyInnings,
      finalInnings: input.finalInnings,
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
        stage: m.stage,
        gameNo: m.gameNo,
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
  for (const [i, id] of seeds.entries())
    await tx
      .update(teamSeason)
      .set({ seed: input.seedOffset + i + 1 })
      .where(eq(teamSeason.id, id as TeamSeasonId));

  const games: PlayoffPlacement[] = [];
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
    games.push({ gameId, slotId: row.slotId });
  }
  await recordAudit(tx, {
    actorId: input.actorId,
    action: "bracket.create",
    entityType: "bracket",
    entityId: bracketId,
    after: {
      divisionId: input.divisionId,
      tier: input.tier,
      format: input.format,
      thirdPlace: input.thirdPlace,
      teams: seeds.length,
      rounds: roundCount(seeds.length),
      unplaced: placed.matches.filter((m) => m.slotId === null).length,
    },
  });
  return { bracketId, games };
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
    // A season's draft brackets share one schedule version.
    const found = await tx
      .select()
      .from(bracket)
      .where(eq(bracket.seasonId, seasonId))
      .for("update");
    const drafts = found.filter((b) => b.status === "draft");
    const [draft] = drafts;
    if (!draft?.scheduleVersionId)
      return err(found.length > 0 ? "already_published" : "no_bracket");
    const versionId = draft.scheduleVersionId;
    // A schedule published meanwhile makes this draft stale: checked under
    // the season's publish lock, so none can land between check and publish.
    await lockSchedulePublish(tx, seasonId);
    const [version] = await tx
      .select({ parent: scheduleVersion.parentVersionId })
      .from(scheduleVersion)
      .where(eq(scheduleVersion.id, versionId));
    if (version?.parent !== (await publishedVersionId(tx, seasonId)))
      return err("stale");
    const published = await publishVersion(tx, versionId, actorId, now);
    if (!published.ok)
      return err(
        published.error === "has_violations" ? "has_violations" : "stale",
      );
    await tx
      .update(bracket)
      .set({ status: "published" })
      .where(
        inArray(
          bracket.id,
          drafts.map((b) => b.id),
        ),
      );
    await tx
      .update(season)
      .set({ status: "playoffs" })
      .where(
        and(
          eq(season.id, seasonId),
          inArray(season.status, ["registration_closed", "in_progress"]),
        ),
      );
    for (const b of drafts)
      await recordAudit(tx, {
        actorId,
        action: "bracket.publish",
        entityType: "bracket",
        entityId: b.id,
        after: { scheduleVersionId: versionId },
      });
    return ok(draft.id);
  });
}

async function matchStates(db: Db, bracketId: BracketId) {
  const rows = await db
    .select()
    .from(bracketMatch)
    .where(eq(bracketMatch.bracketId, bracketId))
    .orderBy(
      asc(bracketMatch.gameNo),
      asc(bracketMatch.roundNo),
      asc(bracketMatch.position),
    );
  const numbers = gameNumbers(
    rows.map((r) => ({
      code: r.code,
      round: r.roundNo,
      position: r.position,
      gameNo: r.gameNo,
    })),
  );
  const states: MatchState[] = rows.map((r) => ({
    code: r.code,
    stage: r.stage,
    round: r.roundNo,
    position: r.position,
    gameNo: numbers.get(r.code) ?? 0,
    sourceA: r.sourceA,
    sourceB: r.sourceB,
    teamA: r.teamAId,
    teamB: r.teamBId,
    winner: r.winnerId,
    skipped: r.skipped,
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
 * Moves a finished playoff game's winner on, and its loser where the
 * bracket has a place for them (the losers' side, the third-place game).
 * Safe to call any number of times: an unchanged result does nothing.
 * When a later match now has both teams, its game is created and
 * published, in the slot the bracket reserved for it unless a rain-out
 * pushed an earlier game past that slot. A corrected result swaps the
 * teams in later games while those are still to be played; after that,
 * it is audited for an admin. A grand final won by the winners' side
 * champion skips the "if necessary" game and frees its slot.
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
      bracketStatus: bracket.status,
      championId: bracket.championId,
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
  if (before?.winner === winner && result.moves.length === 0 && !result.skipped)
    return { kind: "unchanged" };

  await db
    .update(bracketMatch)
    .set({ winnerId: winner })
    .where(eq(bracketMatch.id, found.matchId));

  let scheduled: GameId | null = null;
  let conflict = false;
  const touched = [
    ...new Set([
      ...result.moves.map((m) => m.code),
      ...(result.skipped ? [result.skipped.code] : []),
    ]),
  ];
  for (const code of touched) {
    const row = required(
      rows.find((r) => r.code === code),
      "next match",
    );
    const next = required(
      result.matches.find((m) => m.code === code),
      "next match",
    );
    await db
      .update(bracketMatch)
      .set({
        teamAId: next.teamA as TeamSeasonId | null,
        teamBId: next.teamB as TeamSeasonId | null,
        skipped: next.skipped,
      })
      .where(eq(bracketMatch.id, row.id));
    // A skipped game's reserved slot goes back to the league; a game
    // needed again takes it back if it is still free.
    if (row.slotId && next.skipped !== row.skipped)
      await db
        .update(slot)
        .set({ kind: next.skipped ? "regular" : "playoff" })
        .where(eq(slot.id, row.slotId));
    if (row.gameId) {
      const [nextGame] = await db
        .select({ status: game.status })
        .from(game)
        .where(eq(game.id, row.gameId));
      if (nextGame?.status !== "scheduled") conflict = true;
      else if (isReady(next))
        await db
          .update(game)
          .set({
            teamAId: next.teamA as TeamSeasonId,
            teamBId: next.teamB as TeamSeasonId,
          })
          .where(eq(game.id, row.gameId));
      else {
        // The game is no longer on: a corrected result took a team back
        // out, or the "if necessary" final is not needed after all.
        await db
          .update(game)
          .set({ status: "cancelled" })
          .where(eq(game.id, row.gameId));
        await db
          .update(bracketMatch)
          .set({ gameId: null })
          .where(eq(bracketMatch.id, row.id));
      }
    } else if (isReady(next)) {
      const created = await createGame(db, found.seasonId, row.id, next, null);
      const earliest = await sourcesEnd(db, rows, next);
      await scheduleGame(
        db,
        found.seasonId,
        created,
        row.slotId,
        earliest,
        now,
      );
      scheduled ??= created;
    }
  }

  const champion = result.champion as TeamSeasonId | null;
  if (champion !== found.championId)
    await db
      .update(bracket)
      .set(
        champion
          ? { status: "complete", championId: champion }
          : { status: "published", championId: null },
      )
      .where(eq(bracket.id, found.bracketId));
  await recordAudit(db, {
    actorId: null,
    action: conflict ? "bracket.advance_conflict" : "bracket.advance",
    entityType: "bracket",
    entityId: found.bracketId,
    before: { match: found.code, winner: before?.winner ?? null },
    after: {
      match: found.code,
      winner,
      scheduled,
      champion,
      ...(result.skipped ? { skipped: result.skipped } : {}),
    },
  });
  return { kind: "advanced", winner, scheduled, champion, conflict };
}

/**
 * When the games a match waits on end: the latest end of their slots. A
 * later game must not start before it, wherever a rain-out moved them.
 */
async function sourcesEnd(
  db: Db,
  rows: readonly (typeof bracketMatch.$inferSelect)[],
  m: MatchState,
): Promise<Date | null> {
  const codes = [m.sourceA, m.sourceB].flatMap((s) =>
    "winnerOf" in s ? [s.winnerOf] : "loserOf" in s ? [s.loserOf] : [],
  );
  const games = rows
    .filter((r) => codes.includes(r.code))
    .flatMap((r) => (r.gameId ? [r.gameId] : []));
  if (games.length === 0) return null;
  const [found] = await db
    .select({ endsAt: sql<Date | null>`max(${slot.endsAt})` })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .where(inArray(game.id, games));
  return found?.endsAt ? new Date(found.endsAt) : null;
}

/**
 * Puts a new playoff game on the published schedule: a new version, made
 * from the published one with this game added, published by the league.
 * It takes its reserved slot unless something else holds it or it starts
 * before `notBefore` (an earlier game was rained out and moved later);
 * then the next free open slot after `notBefore`, or no slot at all, so
 * the game shows "time to be set" until an admin places it.
 */
async function scheduleGame(
  db: Db,
  seasonId: SeasonId,
  gameId: GameId,
  slotId: SlotId | null,
  notBefore: Date | null,
  now: Date,
) {
  // Two results recorded at once each add their game to the published
  // schedule: they take turns, so the second builds on the first's.
  await lockSchedulePublish(db, seasonId);
  const publishedId = await publishedVersionId(db, seasonId);
  if (!publishedId) return;
  const published = required(
    await loadVersion(db, publishedId),
    "published version",
  );
  const taken = await takenSlots(db, seasonId);
  const fits = (s: { id: string; startsAt: Date; status: string }) =>
    !taken.has(s.id) &&
    s.status === "open" &&
    (notBefore === null || s.startsAt >= notBefore);
  let chosen: SlotId | null = null;
  if (slotId) {
    const [reserved] = await db
      .select({ id: slot.id, startsAt: slot.startsAt, status: slot.status })
      .from(slot)
      .where(eq(slot.id, slotId));
    if (reserved && fits(reserved)) chosen = reserved.id;
  }
  if (!chosen && notBefore) {
    const later = await db
      .select({ id: slot.id, startsAt: slot.startsAt, status: slot.status })
      .from(slot)
      .where(
        and(
          eq(slot.seasonId, seasonId),
          eq(slot.status, "open"),
          sql`${slot.startsAt} >= ${notBefore}`,
          sql`${slot.kind} <> 'makeup_reserve'`,
        ),
      )
      .orderBy(asc(slot.startsAt), asc(slot.fieldId));
    const found = later.find(fits);
    if (found) {
      chosen = found.id;
      await db
        .update(slot)
        .set({ kind: "playoff" })
        .where(eq(slot.id, found.id));
    }
  }
  const versionId = await saveVersion(db, {
    seasonId,
    input: published.input,
    schedule: published.schedule,
    origin: "playoffs",
    parentVersionId: published.id,
    playoffs: [...published.playoffs, { gameId, slotId: chosen }],
  });
  await publishVersion(db, versionId, null, now);
}

export type BracketView = NonNullable<Awaited<ReturnType<typeof bracketView>>>;
export type BracketViewMatch = BracketView["matches"][number];

/**
 * The season's bracket for display, or its first when each division has
 * its own. Drafts are shown only when asked for, which only admins do.
 */
export async function bracketView(
  db: Db,
  seasonId: SeasonId,
  options: { includeDraft?: boolean } = {},
) {
  const [first] = await bracketViews(db, seasonId, options);
  return first ?? null;
}

/**
 * Every bracket of the season for display: one, or one per division
 * (ADR 0040), in the divisions' order.
 */
export async function bracketViews(
  db: Db,
  seasonId: SeasonId,
  { includeDraft = false }: { includeDraft?: boolean } = {},
) {
  const found = await db
    .select({
      bracket,
      division: { id: division.id, name: division.name, slug: division.slug },
    })
    .from(bracket)
    .leftJoin(division, eq(bracket.divisionId, division.id))
    .where(eq(bracket.seasonId, seasonId))
    .orderBy(
      sql`${division.sortOrder} nulls first`,
      asc(division.name),
      asc(bracket.tier),
    );
  const shown = found.filter(
    (f) => f.bracket.status !== "draft" || includeDraft,
  );
  if (shown.length === 0) return [];
  const [entries, settings] = await Promise.all([
    db
      .select({
        id: teamSeason.id,
        name: team.name,
        slug: team.slug,
        colorHex: team.colorHex,
      })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(eq(teamSeason.seasonId, seasonId)),
    seasonZone(db, seasonId),
  ]);
  const teams = new Map(entries.map((e) => [e.id as string, e]));
  return Promise.all(
    shown.map((f) =>
      viewOf(db, f.bracket, f.division, teams, settings?.timeZone ?? "UTC"),
    ),
  );
}

async function viewOf(
  db: Db,
  found: typeof bracket.$inferSelect,
  divisionOf: { id: DivisionId; name: string; slug: string } | null,
  teams: Map<string, { name: string; slug: string; colorHex: string | null }>,
  timeZone: string,
) {
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
      stage: bracketMatch.stage,
      gameNo: bracketMatch.gameNo,
      skipped: bracketMatch.skipped,
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
    .orderBy(
      asc(bracketMatch.gameNo),
      asc(bracketMatch.roundNo),
      asc(bracketMatch.position),
    );
  const numbers = gameNumbers(rows);
  const innings = (m: {
    stage: (typeof rows)[number]["stage"];
    round: number;
  }) =>
    decidesTitle(m, found.size, found.format)
      ? found.finalInnings
      : found.earlyInnings;
  return {
    id: found.id,
    division: divisionOf,
    tier: found.tier,
    format: found.format,
    thirdPlace: found.thirdPlace,
    earlyInnings: found.earlyInnings,
    finalInnings: found.finalInnings,
    status: found.status,
    size: found.size,
    rounds: roundCount(found.size),
    diagnostics: found.diagnostics,
    timeZone,
    champion: side(found.championId),
    seeds: found.seeds.map((s) => ({
      seed: s.seed,
      team: side(s.teamSeasonId),
    })),
    // A game keeps its match's side order, so its scores line up.
    matches: rows.map((r) => ({
      code: r.code,
      stage: r.stage,
      gameNo: numbers.get(r.code) ?? 0,
      skipped: r.skipped,
      innings: innings(r),
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
