import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { user } from "@/db/schema/auth";
import { event } from "@/db/schema/event";
import { season } from "@/db/schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "@/db/schema/team";
import { eventSlug, parseEventForm } from "@/domain/events/event";
import type { EventId, RegistrationId, RosterMembershipId } from "@/domain/ids";
import { PERSONAS } from "@/lib/demo/personas";
import type { SeedData } from "./generate";

/**
 * Who sees what, in the demo (src/domain/events/audience.ts):
 * - A members-only party with a Partiful-style invite (an invented link on
 *   the reserved example.test domain) instead of RSVPs in the app. Members
 *   see it in the app; it has no public page.
 * - Reese Ref played for Foul Play in Summer 2026, so a team event for this
 *   season's teams shows the difference between a past roster and a
 *   current one.
 * Runs after the demo personas and past seasons are in.
 */

const id = <T extends string>(n: number) =>
  `e7ea0000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export const SEED_PROM = {
  kind: "party",
  title: "Spring prom",
  place: "The Example Ballroom (demo venue), 300 Sample Ave, Brooklyn",
  description:
    "Dress up (or don't), dance, and crown the league's prom court. Members only: bring your teammates, not strangers.",
  capacity: "",
  startsOn: "2027-03-20",
  startTime: "20:00",
  endsOn: "",
  endTime: "23:30",
} as const;

export const SEED_PROM_INVITE = "https://partiful.example.test/e/spring-prom";

export async function addAudienceDemo(db: Db, data: SeedData): Promise<void> {
  const timeZone = data.league.timezone;
  const parsed = parseEventForm(SEED_PROM, timeZone);
  if (!parsed.ok) throw new Error(`Seed prom: ${parsed.error}`);
  await db.insert(event).values({
    ...parsed.value,
    id: id<EventId>(1),
    leagueId: data.league.id,
    slug: eventSlug(parsed.value.title, parsed.value.startsAt, timeZone),
    audience: "members",
    inviteUrl: SEED_PROM_INVITE,
    inAppRsvp: false,
  });

  const [reese] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, PERSONAS.ref.email));
  if (!reese) throw new Error("The seed has no Reese Ref");
  const [entry] = await db
    .select({ id: teamSeason.id, seasonId: teamSeason.seasonId })
    .from(teamSeason)
    .innerJoin(season, eq(season.id, teamSeason.seasonId))
    .innerJoin(team, eq(team.id, teamSeason.teamId))
    .where(
      and(
        eq(season.leagueId, data.league.id),
        eq(season.slug, "summer-2026"),
        eq(team.slug, "foul-play"),
      ),
    );
  if (!entry) throw new Error("The seed has no Foul Play in Summer 2026");
  await db.insert(registration).values({
    id: id<RegistrationId>(2),
    seasonId: entry.seasonId,
    userId: reese.id,
    kind: "team_member",
    status: "active",
  });
  await db.insert(rosterMembership).values({
    id: id<RosterMembershipId>(3),
    teamSeasonId: entry.id,
    registrationId: id<RegistrationId>(2),
    role: "player",
    status: "active",
    startedAt: new Date("2026-06-01T16:00:00Z"),
    endedAt: new Date("2026-08-02T22:00:00Z"),
  });
}
