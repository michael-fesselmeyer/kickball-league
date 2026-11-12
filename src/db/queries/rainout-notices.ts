import { and, eq, inArray, ne } from "drizzle-orm";
import type { SeasonId, SlotId, TeamSeasonId } from "@/domain/ids";
import type { ScheduleDiff } from "@/domain/scheduler/diff";
import { gameKey } from "@/domain/scheduler/types";
import type { RainoutNoticePayload } from "@/emails/rainout-notice";
import { field, game, slot } from "../schema/game";
import { league } from "../schema/league";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * Rain-out notices (product-spec.md, "Rain-outs"): when a schedule that
 * moves games out of rained-out slots is published, every player on both
 * teams of each moved game hears that game's makeup time. Called inside the
 * publishing transaction, so the notices and the new schedule commit
 * together.
 *
 * A game counts as rained out when the slot it moved from is cancelled.
 * Games that did not move, or moved for another reason, get no notice.
 * Each notice's dedupe key names the game, the rained-out slot and the
 * person, so publishing again, retrying, or a later version that moves the
 * same game out of the same slot never sends it twice. Returns how many
 * notices were new.
 */
export async function queueRainoutNotices(
  db: Db,
  seasonId: SeasonId,
  moved: ScheduleDiff["moved"],
  now: Date,
): Promise<number> {
  const fromIds = [
    ...new Set(moved.flatMap((m) => (m.from ? [m.from as SlotId] : []))),
  ];
  if (fromIds.length === 0) return 0;
  const rainedOut = new Set(
    (
      await db
        .select({ id: slot.id })
        .from(slot)
        .where(and(inArray(slot.id, fromIds), eq(slot.status, "cancelled")))
    ).map((s) => s.id as string),
  );
  const postponed = moved.filter((m) => m.from && rainedOut.has(m.from));
  if (postponed.length === 0) return 0;

  const slotIds = [
    ...new Set(
      postponed.flatMap((m) => [m.from, m.to]).filter((s) => s !== null),
    ),
  ] as SlotId[];
  const [about, slots, games, entries] = await Promise.all([
    db
      .select({
        name: season.name,
        slug: season.slug,
        timeZone: league.timezone,
      })
      .from(season)
      .innerJoin(league, eq(season.leagueId, league.id))
      .where(eq(season.id, seasonId)),
    db
      .select({ id: slot.id, startsAt: slot.startsAt, fieldName: field.name })
      .from(slot)
      .innerJoin(field, eq(slot.fieldId, field.id))
      .where(inArray(slot.id, slotIds)),
    db
      .select({
        id: game.id,
        roundNo: game.roundNo,
        teamAId: game.teamAId,
        teamBId: game.teamBId,
      })
      .from(game)
      .where(eq(game.seasonId, seasonId)),
    db
      .select({ id: teamSeason.id, name: team.name })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(eq(teamSeason.seasonId, seasonId)),
  ]);
  const { name, slug, timeZone } = required(about[0], "season");
  const format = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const where = new Map(
    slots.map((s) => [
      s.id as string,
      `${format.format(s.startsAt)}, ${s.fieldName}`,
    ]),
  );
  const teamName = new Map(entries.map((e) => [e.id as string, e.name]));
  const byKey = new Map(
    games
      .filter((g) => g.roundNo !== null)
      .map((g) => [gameKey(g.roundNo ?? 0, g.teamAId, g.teamBId), g]),
  );

  const notices = postponed.flatMap((m) => {
    const g = byKey.get(m.gameKey);
    const was = m.from ? where.get(m.from) : undefined;
    return g && m.from && was ? [{ game: g, from: m.from, to: m.to, was }] : [];
  });
  const playing = [
    ...new Set(notices.flatMap((n) => [n.game.teamAId, n.game.teamBId])),
  ] as TeamSeasonId[];
  const roster =
    playing.length === 0
      ? []
      : await db
          .select({
            teamSeasonId: rosterMembership.teamSeasonId,
            userId: registration.userId,
          })
          .from(rosterMembership)
          .innerJoin(
            registration,
            eq(rosterMembership.registrationId, registration.id),
          )
          .where(
            and(
              inArray(rosterMembership.teamSeasonId, playing),
              eq(rosterMembership.status, "active"),
              ne(registration.status, "cancelled"),
              ne(registration.status, "refunded"),
            ),
          );

  const messages = new Map<string, OutboxMessage>();
  for (const n of notices) {
    const payload = {
      seasonName: name,
      seasonSlug: slug,
      teams: `${teamName.get(n.game.teamAId) ?? "TBD"} vs ${teamName.get(n.game.teamBId) ?? "TBD"}`,
      was: n.was,
      makeup: n.to ? (where.get(n.to) ?? null) : null,
    } satisfies RainoutNoticePayload;
    for (const r of roster) {
      if (
        r.teamSeasonId !== n.game.teamAId &&
        r.teamSeasonId !== n.game.teamBId
      )
        continue;
      const dedupeKey = `rainout/${n.game.id}/${n.from}/${r.userId}`;
      messages.set(dedupeKey, {
        userId: r.userId,
        topic: "rainout",
        template: "rainout_notice",
        payload,
        dedupeKey,
        sendAfter: now,
      });
    }
  }
  return enqueueMessages(db, [...messages.values()]);
}
