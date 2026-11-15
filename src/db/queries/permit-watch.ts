import { and, eq, inArray } from "drizzle-orm";
import type { FieldId, GameId } from "@/domain/ids";
import {
  type PermitEndRule,
  permitEndFor,
  permitEndRule,
} from "@/domain/gameday/permit-end";
import { type GameLimits, gameLimits } from "@/domain/gameday/game-clock";
import { division, ruleSet } from "../schema/division";
import { game, slot } from "../schema/game";
import { permitWindow } from "../schema/schedule";
import { teamSeason } from "../schema/team";
import type { Db } from "./schedule";

/**
 * What the permit-end watch needs about a game (issue #406), read once and
 * saved with the game's screen: where its field's permit ends, and the rule
 * set that sets its time limit and number of innings (regulation without
 * one). Nothing here changes
 * during a game, so a screen loaded before the signal dropped keeps working.
 */
export type PermitInfo = {
  /** The end of the league's hold on the field for this game's slot. */
  permitEndsAt: Date;
  slotStartsAt: Date;
  timeLimitMinutes: number | null;
  innings: number | null;
  rule: PermitEndRule;
};

/**
 * Permit info for each game that has a slot cut from a permit window. A game
 * with no slot, or a slot not cut from a window, is left out. Windows on the
 * field that touch the game's own window extend its end; a lost window never
 * counts. A crossover game uses its first team's division for the rules.
 * Two queries, whatever the number of games.
 */
export async function permitInfoFor(
  db: Db,
  gameIds: readonly GameId[],
): Promise<Map<GameId, PermitInfo>> {
  const out = new Map<GameId, PermitInfo>();
  if (gameIds.length === 0) return out;
  const rows = await db
    .select({
      id: game.id,
      fieldId: slot.fieldId,
      slotStartsAt: slot.startsAt,
      windowStartsAt: permitWindow.startsAt,
      windowEndsAt: permitWindow.endsAt,
      ruleSetId: ruleSet.id,
      timeLimitMinutes: ruleSet.timeLimitMinutes,
      innings: ruleSet.innings,
      options: ruleSet.options,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(permitWindow, eq(slot.permitWindowId, permitWindow.id))
    .innerJoin(teamSeason, eq(game.teamAId, teamSeason.id))
    .leftJoin(division, eq(teamSeason.divisionId, division.id))
    .leftJoin(ruleSet, eq(division.ruleSetId, ruleSet.id))
    .where(inArray(game.id, [...gameIds]));
  if (rows.length === 0) return out;
  const fields = [...new Set(rows.map((r) => r.fieldId))] as FieldId[];
  const held = await db
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
    const limits = gameLimits(r.ruleSetId === null ? null : r);
    out.set(r.id, {
      permitEndsAt: permitEndFor(
        { startsAt: r.windowStartsAt, endsAt: r.windowEndsAt },
        held.filter((h) => h.fieldId === r.fieldId),
      ),
      slotStartsAt: r.slotStartsAt,
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
