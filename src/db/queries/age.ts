import { eq } from "drizzle-orm";
import {
  type AgeRefusal,
  checkAge,
  minimumAgeFor,
} from "@/domain/registration/age";
import type { SeasonId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import { localDay } from "@/domain/schedule/public-game";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import type { Db } from "./schedule";

/** What a registration or signature stores about the age check. */
export type AgeConfirmation = { ageConfirmedMin: number; ageConfirmedAt: Date };

/**
 * The age check for one person and season (ADR 0041), in one query: the
 * season's minimum age (else the league's), the league's time zone and the
 * birth date on the person's profile. Returns the columns to store.
 */
export async function confirmAge(
  db: Db,
  input: {
    userId: UserId;
    seasonId: SeasonId;
    confirmed: boolean;
    now: Date;
  },
): Promise<Result<AgeConfirmation, AgeRefusal>> {
  const [row] = await db
    .select({
      seasonMinimum: season.minimumAge,
      leagueMinimum: league.minimumAge,
      timeZone: league.timezone,
      birthDate: profile.birthDate,
    })
    .from(season)
    .innerJoin(league, eq(league.id, season.leagueId))
    .leftJoin(profile, eq(profile.userId, input.userId))
    .where(eq(season.id, input.seasonId));
  if (!row) return err("age_unconfirmed");
  const checked = checkAge({
    confirmed: input.confirmed,
    minimumAge: minimumAgeFor(
      { minimumAge: row.leagueMinimum },
      { minimumAge: row.seasonMinimum },
    ),
    birthDate: row.birthDate,
    today: localDay(input.now, row.timeZone),
  });
  return checked.ok
    ? ok({
        ageConfirmedMin: checked.value.minimumAge,
        ageConfirmedAt: input.now,
      })
    : checked;
}
