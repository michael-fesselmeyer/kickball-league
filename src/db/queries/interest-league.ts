import { and, desc, eq, inArray } from "drizzle-orm";
import type { InterestOptionId, LeagueId, UserId } from "@/domain/ids";
import { draftLeague, type SeasonTemplate } from "@/domain/league/draft-league";
import type { Sport } from "@/domain/league/new-league";
import { err, ok, type Result } from "@/domain/result";
import { interestForm, interestOption } from "../schema/interest";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { recordAudit } from "./audit";
import { createLeague } from "./leagues";
import type { Db } from "./schedule";

/**
 * Opening a league from an interest option (ADR 0072): one step from "this
 * option has enough interest" to a new league with a draft season, which
 * the operator then gives owners and the admins finish before registration
 * opens. Only the operator starts leagues (ADR 0048), so only the operator
 * calls this.
 */

export type OpenLeagueError = "not_found" | "already_opened" | "slug_taken";

export type OpenedLeague = {
  leagueId: LeagueId;
  name: string;
  slug: string;
  seasonSlug: string;
};

/** Run in a transaction: it locks the option, so it opens one league once. */
export async function openLeagueFromOption(
  db: Db,
  input: {
    optionId: InterestOptionId;
    sport: Sport;
    actorId: UserId;
    /** Today in the asking league's time zone, "2026-11-15". */
    today: string;
  },
): Promise<Result<OpenedLeague, OpenLeagueError>> {
  const [option] = await db
    .select({
      id: interestOption.id,
      night: interestOption.night,
      format: interestOption.format,
      park: interestOption.park,
      openedLeagueId: interestOption.openedLeagueId,
      leagueId: interestForm.leagueId,
      teamsNeeded: interestForm.teamsNeeded,
      playersPerTeam: interestForm.playersPerTeam,
    })
    .from(interestOption)
    .innerJoin(interestForm, eq(interestOption.formId, interestForm.id))
    .where(eq(interestOption.id, input.optionId))
    .for("update", { of: interestOption });
  if (!option) return err("not_found");
  if (option.openedLeagueId) return err("already_opened");
  const [[source], [latest], taken] = await Promise.all([
    db
      .select({
        timeZone: league.timezone,
        minimumAge: league.minimumAge,
        branding: league.branding,
      })
      .from(league)
      .where(eq(league.id, option.leagueId)),
    // The asking league's latest own season sets the fees and roster sizes.
    db
      .select({
        feeModel: season.feeModel,
        teamFeeCents: season.teamFeeCents,
        playerFeeCents: season.playerFeeCents,
        freeAgentFeeCents: season.freeAgentFeeCents,
        rosterMin: season.rosterMin,
        rosterMax: season.rosterMax,
      })
      .from(season)
      .where(
        and(
          eq(season.leagueId, option.leagueId),
          eq(season.visibility, "league"),
        ),
      )
      .orderBy(desc(season.startsOn))
      .limit(1),
    db.select({ slug: league.slug }).from(league),
  ]);
  if (!source) return err("not_found");
  const template: SeasonTemplate | null = latest ?? null;
  const draft = draftLeague({
    choice: { night: option.night, format: option.format, park: option.park },
    sport: input.sport,
    source: {
      timeZone: source.timeZone,
      minimumAge: source.minimumAge,
      primaryColor: source.branding.primaryColor ?? "#1F3A8A",
      secondaryColor: source.branding.secondaryColor ?? "#F5B301",
    },
    template,
    teamsNeeded: option.teamsNeeded,
    playersPerTeam: option.playersPerTeam,
    takenSlugs: new Set(taken.map((t) => t.slug)),
    today: input.today,
  });
  const created = await createLeague(db, {
    ...draft.league,
    actorId: input.actorId,
  });
  if (!created.ok) return err(created.error);
  await db.insert(season).values({
    ...draft.season,
    leagueId: created.value,
    createdBy: input.actorId,
  });
  await db
    .update(interestOption)
    .set({ openedLeagueId: created.value })
    .where(eq(interestOption.id, option.id));
  await recordAudit(db, {
    leagueId: option.leagueId,
    actorId: input.actorId,
    action: "interest.open_league",
    entityType: "interest_option",
    entityId: option.id,
    after: { leagueId: created.value, slug: draft.league.slug },
  });
  return ok({
    leagueId: created.value,
    name: draft.league.name,
    slug: draft.league.slug,
    seasonSlug: draft.season.slug,
  });
}

/** The leagues opened from these options, by option. */
export async function openedLeagues(
  db: Db,
  optionIds: readonly InterestOptionId[],
): Promise<Map<InterestOptionId, { name: string; slug: string }>> {
  if (optionIds.length === 0) return new Map();
  const rows = await db
    .select({
      optionId: interestOption.id,
      name: league.name,
      slug: league.slug,
    })
    .from(interestOption)
    .innerJoin(league, eq(interestOption.openedLeagueId, league.id))
    .where(inArray(interestOption.id, [...optionIds]));
  return new Map(rows.map((r) => [r.optionId, { name: r.name, slug: r.slug }]));
}
