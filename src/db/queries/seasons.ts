import { and, eq, ne, sql } from "drizzle-orm";
import type { LeagueId, SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { SeasonSettings } from "@/domain/season/settings";
import { season } from "../schema/season";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";
import { required } from "./rows";

/** Season setup (product-spec.md, "League admin"). Changes are audited. */

export const SEASON_STATUSES = [
  "draft",
  "registration_open",
  "registration_closed",
  "in_progress",
  "playoffs",
  "completed",
] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

const SETTINGS = {
  name: season.name,
  slug: season.slug,
  startsOn: season.startsOn,
  endsOn: season.endsOn,
  feeModel: season.feeModel,
  teamFeeCents: season.teamFeeCents,
  playerFeeCents: season.playerFeeCents,
  freeAgentFeeCents: season.freeAgentFeeCents,
  earlyBirdEndsAt: season.earlyBirdEndsAt,
  earlyBirdDiscountCents: season.earlyBirdDiscountCents,
  registrationOpensAt: season.registrationOpensAt,
  registrationClosesAt: season.registrationClosesAt,
  paymentDeadlineAt: season.paymentDeadlineAt,
  maxTeams: season.maxTeams,
  rosterMin: season.rosterMin,
  rosterMax: season.rosterMax,
  gamesPerTeamPerDay: season.gamesPerTeamPerDay,
  minimumAge: season.minimumAge,
};

/** The column allows 1 or 2 (a check constraint); anything else reads as 1. */
const gamesPerDay = (n: number): 1 | 2 => (n === 2 ? 2 : 1);

export async function seasonSettings(db: Db, leagueId: LeagueId, slug: string) {
  const [found] = await db
    .select({
      id: season.id,
      status: season.status,
      hasWaiver: sql<boolean>`${season.waiverId} is not null`,
      ...SETTINGS,
    })
    .from(season)
    .where(and(eq(season.leagueId, leagueId), eq(season.slug, slug)));
  if (!found) return null;
  return {
    ...found,
    gamesPerTeamPerDay: gamesPerDay(found.gamesPerTeamPerDay),
  };
}

async function slugTaken(
  db: Db,
  leagueId: LeagueId,
  slug: string,
  except?: SeasonId,
) {
  const [found] = await db
    .select({ id: season.id })
    .from(season)
    .where(
      and(
        eq(season.leagueId, leagueId),
        eq(season.slug, slug),
        except ? ne(season.id, except) : undefined,
      ),
    );
  return found !== undefined;
}

/** Creates a season as a draft; players see nothing until it opens. */
export async function createSeason(
  db: Db,
  input: { leagueId: LeagueId; settings: SeasonSettings },
  actorId: UserId,
): Promise<Result<{ id: SeasonId; slug: string }, "duplicate">> {
  const { settings } = input;
  if (await slugTaken(db, input.leagueId, settings.slug))
    return err("duplicate");
  const [created] = await db
    .insert(season)
    .values({
      leagueId: input.leagueId,
      ...settings,
      status: "draft",
      createdBy: actorId,
    })
    .returning({ id: season.id });
  const id = required(created, "season").id;
  await recordAudit(db, {
    actorId,
    action: "season.create",
    entityType: "season",
    entityId: id,
    after: settings,
  });
  return ok({ id, slug: settings.slug });
}

/**
 * Saves edited settings and status; the audit row holds only what changed.
 * Registration can't open until the season has a waiver: players sign it
 * before they can pay, so without one nobody could finish registering.
 */
export async function updateSeason(
  db: Db,
  input: {
    leagueId: LeagueId;
    seasonId: SeasonId;
    settings: SeasonSettings;
    status: SeasonStatus;
  },
  actorId: UserId,
): Promise<
  Result<{ slug: string }, "unknown_season" | "duplicate" | "no_waiver">
> {
  const [before] = await db
    .select({ status: season.status, waiverId: season.waiverId, ...SETTINGS })
    .from(season)
    .where(
      and(eq(season.id, input.seasonId), eq(season.leagueId, input.leagueId)),
    );
  if (!before) return err("unknown_season");
  if (await slugTaken(db, input.leagueId, input.settings.slug, input.seasonId))
    return err("duplicate");
  const { waiverId, ...settingsBefore } = before;
  if (input.status === "registration_open" && waiverId === null)
    return err("no_waiver");
  const after = { ...input.settings, status: input.status };
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter(
    (k) =>
      JSON.stringify(settingsBefore[k] ?? null) !==
      JSON.stringify(after[k] ?? null),
  );
  if (changed.length === 0) return ok({ slug: input.settings.slug });
  await db.update(season).set(after).where(eq(season.id, input.seasonId));
  await recordAudit(db, {
    actorId,
    action: "season.update",
    entityType: "season",
    entityId: input.seasonId,
    before: Object.fromEntries(changed.map((k) => [k, settingsBefore[k]])),
    after: Object.fromEntries(changed.map((k) => [k, after[k]])),
  });
  return ok({ slug: input.settings.slug });
}
