import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  activeSeasonOf,
  type Audience,
  type AudienceChoices,
  canSee,
  type Viewer,
} from "@/domain/events/audience";
import { whenLine } from "@/domain/events/event";
import type { EventId, LeagueId, SeasonId, TeamId, UserId } from "@/domain/ids";
import type { EventNoticePayload } from "@/emails/event";
import { calendarFeed, event, eventAudienceTeam } from "../schema/event";
import { league } from "../schema/league";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import {
  audienceFrom,
  audienceTeamIds,
  type EventDetails,
  eventBySlug,
  type EventSummary,
  leagueEvents,
} from "./events";
import { enqueueMessages } from "./outbox";
import type { Db } from "./schedule";

/**
 * Who an event is for (src/domain/events/audience.ts) against the database:
 * the person looking, the people to tell, and the choices the admin form
 * offers. Membership means a registration that isn't cancelled or refunded;
 * a team's players are its active roster spots.
 */

const LAPSED = ["cancelled", "refunded"] as const;

/**
 * The signed-in person as a viewer of the league's events, in one query:
 * whether they are a member and the teams they have played on.
 */
export async function viewerOf(
  db: Db,
  leagueId: LeagueId,
  userId: UserId,
  staff: boolean,
): Promise<NonNullable<Viewer>> {
  const rows = await db
    .select({
      status: registration.status,
      teamId: teamSeason.teamId,
      seasonId: teamSeason.seasonId,
    })
    .from(registration)
    .innerJoin(season, eq(season.id, registration.seasonId))
    .leftJoin(
      rosterMembership,
      and(
        eq(rosterMembership.registrationId, registration.id),
        eq(rosterMembership.status, "active"),
      ),
    )
    .leftJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
    .where(and(eq(registration.userId, userId), eq(season.leagueId, leagueId)));
  const teams: { teamId: TeamId; seasonId: SeasonId }[] = [];
  for (const r of rows)
    if (r.teamId !== null && r.seasonId !== null)
      teams.push({ teamId: r.teamId, seasonId: r.seasonId });
  return {
    staff,
    member: rows.some((r) => !(LAPSED as readonly string[]).includes(r.status)),
    teams,
  };
}

/**
 * The events a signed-in person may see: the league's events and the
 * person, read in parallel (two queries however many events there are),
 * then filtered by the domain's rule.
 */
export async function eventsFor(
  db: Db,
  leagueId: LeagueId,
  userId: UserId,
  staff: boolean,
): Promise<EventSummary[]> {
  const [events, viewer] = await Promise.all([
    leagueEvents(db, leagueId, "all"),
    viewerOf(db, leagueId, userId, staff),
  ]);
  return events.filter((e) => canSee(e.audience, viewer));
}

/**
 * One event by its slug, if the signed-in person may see it; null when it
 * doesn't exist or isn't for them, so a page can't tell the two apart.
 */
export async function visibleEvent(
  db: Db,
  slug: string,
  userId: UserId,
  staff: boolean,
): Promise<EventDetails | null> {
  const e = await eventBySlug(db, slug, "all");
  if (!e) return null;
  if (e.audience.kind === "public") return e;
  const viewer = await viewerOf(db, e.leagueId, userId, staff);
  return canSee(e.audience, viewer) ? e : null;
}

/**
 * Everyone to tell about an event, in one query: all members for a public
 * or members' event, else the chosen teams' active players (in the chosen
 * season, or any).
 */
export async function eventRecipients(
  db: Db,
  e: { id: EventId; leagueId: LeagueId; audience: Audience },
): Promise<UserId[]> {
  const rows =
    e.audience.kind === "teams"
      ? await db
          .selectDistinct({ userId: registration.userId })
          .from(eventAudienceTeam)
          .innerJoin(
            teamSeason,
            eq(teamSeason.teamId, eventAudienceTeam.teamId),
          )
          .innerJoin(
            rosterMembership,
            eq(rosterMembership.teamSeasonId, teamSeason.id),
          )
          .innerJoin(
            registration,
            eq(registration.id, rosterMembership.registrationId),
          )
          .where(
            and(
              eq(eventAudienceTeam.eventId, e.id),
              eq(rosterMembership.status, "active"),
              e.audience.seasonId === null
                ? undefined
                : eq(teamSeason.seasonId, e.audience.seasonId),
            ),
          )
      : await db
          .selectDistinct({ userId: registration.userId })
          .from(registration)
          .innerJoin(season, eq(season.id, registration.seasonId))
          .where(
            and(
              eq(season.leagueId, e.leagueId),
              notInArray(registration.status, [...LAPSED]),
            ),
          );
  return rows.map((r) => r.userId).sort();
}

export type AnnounceKind = "announced" | "updated";

/**
 * Queues one email per person the event is for, through the outbox with the
 * events topic, so turning event emails off is respected. A new event is
 * announced once per person; each change is its own notice. Run it in the
 * same transaction as the change. Returns how many were queued.
 */
export async function announceEvent(
  db: Db,
  input: { eventId: EventId; kind: AnnounceKind; now: Date },
): Promise<number> {
  const [e] = await db
    .select({
      id: event.id,
      leagueId: event.leagueId,
      slug: event.slug,
      kind: event.kind,
      title: event.title,
      place: event.place,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      cancelledAt: event.cancelledAt,
      audienceKind: event.audience,
      audienceSeasonId: event.audienceSeasonId,
      audienceTeamIds,
      inviteUrl: event.inviteUrl,
      timeZone: league.timezone,
    })
    .from(event)
    .innerJoin(league, eq(league.id, event.leagueId))
    .where(and(eq(event.id, input.eventId), isNull(event.deletedAt)));
  // Nothing to say about an event that is gone, called off or over.
  if (!e || e.cancelledAt || e.endsAt <= input.now) return 0;
  const audience = audienceFrom(e);
  const recipients = await eventRecipients(db, { ...e, audience });
  const payload: EventNoticePayload = {
    kind: input.kind,
    title: e.title,
    slug: e.slug,
    when: whenLine(e, e.timeZone),
    place: e.place,
    inviteUrl: e.inviteUrl,
    publicPage: e.audienceKind === "public",
  };
  const stamp = input.kind === "announced" ? "new" : input.now.getTime();
  return enqueueMessages(
    db,
    recipients.map((userId) => ({
      userId,
      topic: "events",
      template: "event_notice",
      payload,
      dedupeKey: `event_${input.kind}/${e.id}/${stamp}/${userId}`,
    })),
  );
}

/**
 * What the admin form offers: each season past draft with the teams that
 * entered it, every team for "any season", and the season to start on.
 * Two queries, read in parallel.
 */
export async function audienceChoices(
  db: Db,
  leagueId: LeagueId,
): Promise<AudienceChoices> {
  const [entries, teams] = await Promise.all([
    db
      .select({
        seasonId: season.id,
        seasonName: season.name,
        status: season.status,
        startsOn: season.startsOn,
        teamId: team.id,
        teamName: team.name,
      })
      .from(season)
      .leftJoin(
        teamSeason,
        and(
          eq(teamSeason.seasonId, season.id),
          ne(teamSeason.status, "withdrawn"),
        ),
      )
      .leftJoin(team, eq(team.id, teamSeason.teamId))
      .where(and(eq(season.leagueId, leagueId), ne(season.status, "draft")))
      .orderBy(sql`${season.startsOn} desc`, asc(team.name)),
    db
      .select({ id: team.id, name: team.name })
      .from(team)
      .where(and(eq(team.leagueId, leagueId), isNull(team.deletedAt)))
      .orderBy(asc(team.name)),
  ]);
  const seasons = new Map<
    SeasonId,
    {
      id: SeasonId;
      name: string;
      status: string;
      startsOn: string;
      teams: { id: TeamId; name: string }[];
    }
  >();
  for (const r of entries) {
    const s = seasons.get(r.seasonId) ?? {
      id: r.seasonId,
      name: r.seasonName,
      status: r.status,
      startsOn: r.startsOn,
      teams: [],
    };
    if (r.teamId !== null && r.teamName !== null)
      s.teams.push({ id: r.teamId, name: r.teamName });
    seasons.set(r.seasonId, s);
  }
  const list = [...seasons.values()];
  return {
    activeSeasonId: activeSeasonOf(list),
    seasons: list.map(({ id, name, teams: entered }) => ({
      id,
      name,
      teams: entered,
    })),
    teams,
  };
}

/** The names behind a teams audience, for its line on a page or message. */
export async function audienceNames(
  db: Db,
  audience: Audience,
): Promise<{ teams: string[]; season: string | null }> {
  if (audience.kind !== "teams" || audience.teamIds.length === 0)
    return { teams: [], season: null };
  const [teams, seasonRow] = await Promise.all([
    db
      .select({ name: team.name })
      .from(team)
      .where(inArray(team.id, [...audience.teamIds]))
      .orderBy(asc(team.name)),
    audience.seasonId === null
      ? Promise.resolve([])
      : db
          .select({ name: season.name })
          .from(season)
          .where(eq(season.id, audience.seasonId)),
  ]);
  return {
    teams: teams.map((t) => t.name),
    season: seasonRow[0]?.name ?? null,
  };
}

/** The current version of someone's feed link; 1 until they reset it. */
export async function feedVersion(db: Db, userId: UserId): Promise<number> {
  const [row] = await db
    .select({ version: calendarFeed.version })
    .from(calendarFeed)
    .where(eq(calendarFeed.userId, userId));
  return row?.version ?? 1;
}

/** A new feed link: the old one stops working. Returns the new version. */
export async function resetFeed(db: Db, userId: UserId): Promise<number> {
  const [row] = await db
    .insert(calendarFeed)
    .values({ userId, version: 2 })
    .onConflictDoUpdate({
      target: calendarFeed.userId,
      set: { version: sql`${calendarFeed.version} + 1` },
    })
    .returning({ version: calendarFeed.version });
  if (!row) throw new Error("The feed was not reset");
  return row.version;
}
