import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { FieldId, GameId } from "@/domain/ids";
import {
  clearByOnGameDay,
  daylightMargin,
  type EndOfPlay,
  endOfPlay,
  type HeldUpBy,
  sunsetFor,
} from "@/domain/gameday/daylight";
import {
  type PermitEndRule,
  permitEndFor,
  permitEndRule,
} from "@/domain/gameday/permit-end";
import { type GameLimits, gameLimits } from "@/domain/gameday/game-clock";
import { division, ruleSet } from "../schema/division";
import { field, game, gameStart, slot, venue } from "../schema/game";
import { gameDayStatus, gameDayStatusGame } from "../schema/game-day";
import { league } from "../schema/league";
import { permitWindow } from "../schema/schedule";
import { season } from "../schema/season";
import { teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/**
 * What a game's clock needs (issues #406 and #467), read once and saved
 * with the game's screen: when the field must be clear, when the light
 * runs out, when play must end, when the game actually started, and the
 * rule set that sets its time limit, innings and what happens at the end
 * (regulation without one). Nothing here but the start changes during a
 * game, so a screen loaded before the signal dropped keeps counting.
 */
export type PermitInfo = {
  /** The slot's start. */
  slotStartsAt: Date;
  /**
   * When the game's clock starts and first pitch is due: the new start when
   * the day's status delays it, otherwise the slot's start.
   */
  clockStartsAt: Date;
  /** The game's day is called off (#383); its clock is not shown. */
  dayOff: boolean;
  /** The end of the league's hold on the field; null with no permit. */
  clearBy: Date | null;
  /** Sunset on the game's day at its park; null on a field with lights. */
  sunsetAt: Date | null;
  /** When play must end, and why: the earlier of the two above. */
  end: EndOfPlay;
  /** The first pitch as recorded at the field; null until then. */
  startedAt: Date | null;
  heldUpBy: HeldUpBy | null;
  timeLimitMinutes: number | null;
  innings: number | null;
  rule: PermitEndRule;
};

export type DayChange = { state: "delayed" | "off"; newStartsAt: Date | null };

/**
 * The games a Delayed or Off game-day status (#383) touches, with a delayed
 * game's new start. A delay counts only when the new start falls after the
 * slot's start and within the same day, so a delay saved for a game day the
 * game has since moved away from is ignored; an Off status counts only on
 * the game's own local day. One query, whatever the number of games.
 */
export async function dayChangesFor(
  db: Db,
  gameIds: readonly GameId[],
): Promise<Map<GameId, DayChange>> {
  const out = new Map<GameId, DayChange>();
  if (gameIds.length === 0) return out;
  const rows = await db
    .select({
      gameId: gameDayStatusGame.gameId,
      state: gameDayStatus.state,
      newStartsAt: gameDayStatusGame.newStartsAt,
    })
    .from(gameDayStatusGame)
    .innerJoin(gameDayStatus, eq(gameDayStatusGame.statusId, gameDayStatus.id))
    .innerJoin(game, eq(gameDayStatusGame.gameId, game.id))
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        inArray(gameDayStatusGame.gameId, [...gameIds]),
        or(
          and(
            eq(gameDayStatus.state, "delayed"),
            gt(gameDayStatusGame.newStartsAt, slot.startsAt),
            sql`${gameDayStatusGame.newStartsAt} < ${slot.startsAt} + interval '1 day'`,
          ),
          and(
            eq(gameDayStatus.state, "off"),
            sql`${gameDayStatus.date} = (${slot.startsAt} at time zone ${league.timezone})::date`,
          ),
        ),
      ),
    );
  for (const r of rows)
    if (r.state === "delayed" || r.state === "off")
      out.set(r.gameId, { state: r.state, newStartsAt: r.newStartsAt });
  return out;
}

/** When first pitch is due, after any delay. */
export const firstPitchOf = (slotStartsAt: Date, change?: DayChange) =>
  change?.state === "delayed" && change.newStartsAt
    ? change.newStartsAt
    : slotStartsAt;

/**
 * The new start of each of these games that its day's status delays
 * (issue #383). A game whose day is Off, On or Watching is left out, and so
 * is a delay saved for a game day the game has since moved away from.
 * One query, whatever the number of games.
 */
export async function delayedStarts(
  db: Db,
  gameIds: readonly GameId[],
): Promise<Map<GameId, Date>> {
  const changes = await dayChangesFor(db, gameIds);
  return new Map(
    [...changes].flatMap(([id, c]) =>
      c.state === "delayed" && c.newStartsAt ? [[id, c.newStartsAt]] : [],
    ),
  );
}

/**
 * Clock info for each game with a slot. A game with no slot, or one on a
 * lit field with no permit window on its own day, has no end of play and
 * is left out. Windows on the field that touch the game's own window extend the field
 * time; a lost window never counts. A crossover game uses its first team's
 * division for the rules. Three queries, whatever the number of games.
 */
export async function permitInfoFor(
  db: Db,
  gameIds: readonly GameId[],
): Promise<Map<GameId, PermitInfo>> {
  const out = new Map<GameId, PermitInfo>();
  if (gameIds.length === 0) return out;
  const [changes, rows] = await Promise.all([
    dayChangesFor(db, gameIds),
    db
      .select({
        id: game.id,
        fieldId: slot.fieldId,
        slotStartsAt: slot.startsAt,
        windowStartsAt: permitWindow.startsAt,
        windowEndsAt: permitWindow.endsAt,
        hasLights: field.hasLights,
        lat: venue.lat,
        lng: venue.lng,
        timeZone: league.timezone,
        startedAt: gameStart.startedAt,
        heldUpBy: gameStart.heldUpBy,
        ruleSetId: ruleSet.id,
        timeLimitMinutes: ruleSet.timeLimitMinutes,
        innings: ruleSet.innings,
        options: ruleSet.options,
      })
      .from(game)
      .innerJoin(slot, eq(game.slotId, slot.id))
      .innerJoin(field, eq(slot.fieldId, field.id))
      .innerJoin(venue, eq(field.venueId, venue.id))
      .innerJoin(season, eq(game.seasonId, season.id))
      .innerJoin(league, eq(season.leagueId, league.id))
      .leftJoin(permitWindow, eq(slot.permitWindowId, permitWindow.id))
      .leftJoin(gameStart, eq(gameStart.gameId, game.id))
      .innerJoin(teamSeason, eq(game.teamAId, teamSeason.id))
      .leftJoin(division, eq(teamSeason.divisionId, division.id))
      .leftJoin(ruleSet, eq(division.ruleSetId, ruleSet.id))
      .where(inArray(game.id, [...gameIds])),
  ]);
  if (rows.length === 0) return out;
  const fields = [
    ...new Set(rows.filter((r) => r.windowEndsAt).map((r) => r.fieldId)),
  ] as FieldId[];
  const held =
    fields.length === 0
      ? []
      : await db
          .select({
            fieldId: permitWindow.fieldId,
            startsAt: permitWindow.startsAt,
            endsAt: permitWindow.endsAt,
          })
          .from(permitWindow)
          .where(
            and(
              inArray(permitWindow.fieldId, fields),
              eq(permitWindow.status, "confirmed"),
            ),
          );
  for (const r of rows) {
    // A window on another day than the game's (one it has moved away
    // from) says nothing about when this game must end.
    const clearBy = clearByOnGameDay(
      r.windowStartsAt && r.windowEndsAt
        ? permitEndFor(
            { startsAt: r.windowStartsAt, endsAt: r.windowEndsAt },
            held.filter((h) => h.fieldId === r.fieldId),
          )
        : null,
      r.slotStartsAt,
      r.timeZone,
    );
    const sunsetAt = r.hasLights
      ? null
      : sunsetFor(
          r.slotStartsAt,
          r.timeZone,
          r.lat !== null && r.lng !== null
            ? { lat: Number(r.lat), lng: Number(r.lng) }
            : null,
        );
    const end = endOfPlay({
      clearBy,
      sunsetAt,
      hasLights: r.hasLights,
      marginMinutes: daylightMargin(r.options),
    });
    if (!end) continue;
    const change = changes.get(r.id);
    const limits = gameLimits(r.ruleSetId === null ? null : r);
    out.set(r.id, {
      slotStartsAt: r.slotStartsAt,
      clockStartsAt: firstPitchOf(r.slotStartsAt, change),
      dayOff: change?.state === "off",
      clearBy,
      sunsetAt,
      end,
      startedAt: r.startedAt,
      heldUpBy: r.heldUpBy,
      timeLimitMinutes: limits.timeLimitMinutes,
      innings: limits.innings,
      rule: permitEndRule(r.options),
    });
  }
  return out;
}

/**
 * A game's innings, time limit and no-new-inning window, from its
 * division's rule set, or regulation when it has none. A crossover game
 * uses its first team's division, as the permit watch does.
 */
export async function gameLimitsFor(
  db: Db,
  gameId: GameId,
): Promise<GameLimits> {
  const [row] = await db
    .select({
      ruleSetId: ruleSet.id,
      innings: ruleSet.innings,
      timeLimitMinutes: ruleSet.timeLimitMinutes,
      options: ruleSet.options,
    })
    .from(game)
    .innerJoin(teamSeason, eq(game.teamAId, teamSeason.id))
    .leftJoin(division, eq(teamSeason.divisionId, division.id))
    .leftJoin(ruleSet, eq(division.ruleSetId, ruleSet.id))
    .where(eq(game.id, gameId));
  return gameLimits(row && row.ruleSetId !== null ? row : null);
}
