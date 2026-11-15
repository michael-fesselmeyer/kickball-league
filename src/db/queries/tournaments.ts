import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { EventId, FriendLeagueId, GuestTeamId, LeagueId, UserId } from "@/domain/ids";
import { hashWaiverBody } from "@/domain/waiver/waiver";
import { err, ok, type Result } from "@/domain/result";
import {
  type BracketError,
  hasResults,
  makeBracket,
  recordScore,
  setPlace,
  teamsIn,
  type TournamentBracket,
} from "@/domain/tournaments/bracket";
import {
  type GuestSignup,
  guestDataDue,
  newLinkToken,
  signupState,
  type SignupState,
  type TournamentSettings,
} from "@/domain/tournaments/tournament";
import { event } from "../schema/event";
import { friendLeague } from "../schema/friends";
import {
  guestTeam,
  guestWaiverSignature,
  tournament,
} from "../schema/tournament";
import { waiver } from "../schema/waiver";
import { league } from "../schema/league";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Guest teams and partner tournaments (ADR 0064, docs/data-model.md,
 * section 2.5). Writes that change a tournament lock its row first, so a
 * sign-up racing the last open spot, or two score entries, run one at a
 * time. The writes record their audit row in the same transaction; callers
 * run them inside one.
 */

const settingsColumns = (s: TournamentSettings) => ({
  guestSignupsOpen: s.guestSignupsOpen,
  maxGuestTeams: s.maxGuestTeams,
  partnerFriendLeagueId: s.partnerFriendLeagueId as FriendLeagueId | null,
  charityName: s.charity?.name ?? null,
  charityUrl: s.charity?.url ?? null,
  charityGoalCents: s.charity?.goalCents ?? null,
  guestDataDays: s.guestDataDays,
});

/** The tournament's settings, or null for an event that is not one. */
export async function tournamentOf(db: Db, eventId: EventId) {
  const [found] = await db
    .select()
    .from(tournament)
    .where(eq(tournament.eventId, eventId));
  return found ?? null;
}

/** Locks the tournament row for the rest of the transaction. */
async function lockTournament(db: Db, eventId: EventId) {
  const [found] = await db
    .select({
      t: tournament,
      endsAt: event.endsAt,
      cancelledAt: event.cancelledAt,
      deletedAt: event.deletedAt,
      kind: event.kind,
    })
    .from(tournament)
    .innerJoin(event, eq(event.id, tournament.eventId))
    .where(eq(tournament.eventId, eventId))
    .for("update", { of: tournament });
  return found ?? null;
}

export type SettingsSaveError = "not_a_tournament" | "partner_unknown" | "under_cap";

/**
 * Turns an event of kind "tournament" into one that takes guest teams, or
 * saves new settings for it. A cap below the teams already signed up, or a
 * partner league outside this league, is refused.
 */
export async function saveTournament(
  db: Db,
  input: {
    leagueId: LeagueId;
    eventId: EventId;
    settings: TournamentSettings;
    actorId: UserId;
  },
): Promise<Result<void, SettingsSaveError>> {
  const [e] = await db
    .select({ kind: event.kind, leagueId: event.leagueId, deletedAt: event.deletedAt })
    .from(event)
    .where(eq(event.id, input.eventId))
    .for("update");
  if (!e || e.leagueId !== input.leagueId || e.deletedAt || e.kind !== "tournament")
    return err("not_a_tournament");
  const partner = input.settings.partnerFriendLeagueId;
  if (partner) {
    const [friend] = await db
      .select({ id: friendLeague.id })
      .from(friendLeague)
      .where(
        and(
          eq(friendLeague.id, partner as FriendLeagueId),
          eq(friendLeague.leagueId, input.leagueId),
        ),
      );
    if (!friend) return err("partner_unknown");
  }
  const before = await tournamentOf(db, input.eventId);
  const max = input.settings.maxGuestTeams;
  if (max !== null) {
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(guestTeam)
      .where(eq(guestTeam.eventId, input.eventId));
    if ((count?.n ?? 0) > max) return err("under_cap");
  }
  const columns = settingsColumns(input.settings);
  await db
    .insert(tournament)
    .values({ eventId: input.eventId, ...columns })
    .onConflictDoUpdate({ target: tournament.eventId, set: columns });
  await recordAudit(db, {
    actorId: input.actorId,
    action: before ? "tournament.update" : "tournament.create",
    entityType: "tournament",
    entityId: input.eventId,
    leagueId: input.leagueId,
    before: before ? settingsOf(before) : null,
    after: input.settings,
  });
  return ok(undefined);
}

const settingsOf = (t: typeof tournament.$inferSelect) => ({
  guestSignupsOpen: t.guestSignupsOpen,
  maxGuestTeams: t.maxGuestTeams,
  partnerFriendLeagueId: t.partnerFriendLeagueId,
  charityName: t.charityName,
  charityUrl: t.charityUrl,
  charityGoalCents: t.charityGoalCents,
  guestDataDays: t.guestDataDays,
});

/* ---------- public view ---------- */

export type PublicTournament = {
  guestSignupsOpen: boolean;
  maxGuestTeams: number | null;
  charity: { name: string; url: string; goalCents: number | null } | null;
  partner: { name: string; url: string } | null;
  /** Team names only: no captain, email or head count. */
  guestTeams: string[];
  bracket: TournamentBracket | null;
  signup: SignupState;
};

/**
 * What the public event page shows for a tournament: settings, the guest
 * teams' names and the bracket, in two queries. Never a captain's name or
 * email.
 */
export async function publicTournament(
  db: Db,
  e: { id: EventId; endsAt: Date; cancelledAt: Date | null },
  now: Date,
): Promise<PublicTournament | null> {
  const [found] = await db
    .select({
      t: tournament,
      partnerName: friendLeague.name,
      partnerUrl: friendLeague.url,
    })
    .from(tournament)
    .leftJoin(friendLeague, eq(friendLeague.id, tournament.partnerFriendLeagueId))
    .where(eq(tournament.eventId, e.id));
  if (!found) return null;
  const teams = await db
    .select({ name: guestTeam.name })
    .from(guestTeam)
    .where(eq(guestTeam.eventId, e.id))
    .orderBy(asc(guestTeam.createdAt), asc(guestTeam.name));
  const t = found.t;
  return {
    guestSignupsOpen: t.guestSignupsOpen,
    maxGuestTeams: t.maxGuestTeams,
    charity:
      t.charityName && t.charityUrl
        ? { name: t.charityName, url: t.charityUrl, goalCents: t.charityGoalCents }
        : null,
    partner:
      found.partnerName && found.partnerUrl
        ? { name: found.partnerName, url: found.partnerUrl }
        : null,
    guestTeams: teams.map((x) => x.name),
    bracket: t.bracket,
    signup: signupState(
      { ...t, guestTeams: teams.length },
      e,
      now,
    ),
  };
}

/** The partner-league cards for the Friends page: tournaments still to come. */
export async function partnerTournaments(db: Db, leagueId: LeagueId, now: Date) {
  const rows = await db
    .select({
      friendLeagueId: tournament.partnerFriendLeagueId,
      slug: event.slug,
      title: event.title,
      startsAt: event.startsAt,
    })
    .from(tournament)
    .innerJoin(event, eq(event.id, tournament.eventId))
    .where(
      and(
        eq(event.leagueId, leagueId),
        isNull(event.deletedAt),
        isNull(event.cancelledAt),
        eq(event.audience, "public"),
        gt(event.endsAt, now),
        isNotNull(tournament.partnerFriendLeagueId),
      ),
    )
    .orderBy(asc(event.startsAt));
  return rows.flatMap((r) =>
    r.friendLeagueId ? [{ ...r, friendLeagueId: r.friendLeagueId }] : [],
  );
}

/* ---------- guest sign-up ---------- */

export type GuestSignupError = Exclude<SignupState, "open"> | "name_taken" | "not_a_tournament";

/** Enters a guest team, if the tournament still has room. */
export async function registerGuestTeam(
  db: Db,
  input: { eventId: EventId; signup: GuestSignup; now: Date },
): Promise<Result<{ id: GuestTeamId; linkToken: string }, GuestSignupError>> {
  const locked = await lockTournament(db, input.eventId);
  if (!locked || locked.deletedAt || locked.t.guestDataDeletedAt)
    return err("not_a_tournament");
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(guestTeam)
    .where(eq(guestTeam.eventId, input.eventId));
  const state = signupState(
    { ...locked.t, guestTeams: count?.n ?? 0 },
    locked,
    input.now,
  );
  if (state !== "open") return err(state);
  // A bracket that is already drawn has no room for a late entry.
  if (locked.t.bracket) return err("closed");
  const linkToken = newLinkToken();
  const [created] = await db
    .insert(guestTeam)
    .values({
      eventId: input.eventId,
      name: input.signup.teamName,
      captainName: input.signup.captainName,
      captainEmail: input.signup.captainEmail,
      rosterSize: input.signup.rosterSize,
      linkToken,
    })
    .onConflictDoNothing()
    .returning({ id: guestTeam.id });
  if (!created) return err("name_taken");
  return ok({ id: created.id, linkToken });
}

/* ---------- waiver by link ---------- */

/** The league's newest waiver version: what a guest is shown. */
export async function latestWaiver(db: Db, leagueId: LeagueId) {
  const [found] = await db
    .select({
      id: waiver.id,
      title: waiver.title,
      bodyMd: waiver.bodyMd,
      bodySha256: waiver.bodySha256,
    })
    .from(waiver)
    .where(eq(waiver.leagueId, leagueId))
    .orderBy(desc(waiver.version))
    .limit(1);
  return found ?? null;
}

/** A guest team from its waiver link, with the event and its waiver. */
export async function guestTeamByToken(db: Db, token: string) {
  const [team] = await db
    .select({
      id: guestTeam.id,
      name: guestTeam.name,
      rosterSize: guestTeam.rosterSize,
      eventId: event.id,
      eventTitle: event.title,
      eventSlug: event.slug,
      endsAt: event.endsAt,
      cancelledAt: event.cancelledAt,
      deletedAt: event.deletedAt,
      leagueId: event.leagueId,
      timeZone: league.timezone,
    })
    .from(guestTeam)
    .innerJoin(event, eq(event.id, guestTeam.eventId))
    .innerJoin(league, eq(league.id, event.leagueId))
    .where(eq(guestTeam.linkToken, token));
  if (!team || team.deletedAt) return null;
  const [signed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(guestWaiverSignature)
    .where(eq(guestWaiverSignature.guestTeamId, team.id));
  return {
    ...team,
    signed: signed?.n ?? 0,
    waiver: await latestWaiver(db, team.leagueId),
  };
}

export type GuestSignError =
  | "no_team"
  | "no_waiver"
  | "changed"
  | "over"
  | "roster_full"
  | "already_signed";

/**
 * Records a guest player's signature through their captain's link. The hash
 * is the one of the text the player was shown: if the league published a new
 * version in between, they are asked to read it again.
 */
export async function signGuestWaiver(
  db: Db,
  input: { token: string; signedName: string; shownSha256: string; now: Date },
): Promise<Result<void, GuestSignError>> {
  const [team] = await db
    .select({
      id: guestTeam.id,
      rosterSize: guestTeam.rosterSize,
      eventId: guestTeam.eventId,
      leagueId: event.leagueId,
      endsAt: event.endsAt,
      cancelledAt: event.cancelledAt,
      deletedAt: event.deletedAt,
    })
    .from(guestTeam)
    .innerJoin(event, eq(event.id, guestTeam.eventId))
    .where(eq(guestTeam.linkToken, input.token))
    .for("update", { of: guestTeam });
  if (!team || team.deletedAt) return err("no_team");
  if (team.cancelledAt || team.endsAt <= input.now) return err("over");
  const current = await latestWaiver(db, team.leagueId);
  if (!current) return err("no_waiver");
  if (current.bodySha256 !== input.shownSha256) return err("changed");
  const [signed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(guestWaiverSignature)
    .where(eq(guestWaiverSignature.guestTeamId, team.id));
  if ((signed?.n ?? 0) >= team.rosterSize) return err("roster_full");
  const [added] = await db
    .insert(guestWaiverSignature)
    .values({
      guestTeamId: team.id,
      waiverId: current.id,
      signedName: input.signedName,
      bodySha256: hashWaiverBody(current.bodyMd),
    })
    .onConflictDoNothing()
    .returning({ id: guestWaiverSignature.id });
  return added ? ok(undefined) : err("already_signed");
}

/* ---------- admin ---------- */

export type AdminGuestTeam = {
  id: GuestTeamId;
  name: string;
  captainName: string;
  captainEmail: string;
  rosterSize: number;
  linkToken: string;
  signed: number;
  createdAt: Date;
};

/** Every guest team with its captain and waiver count, in one query. */
export async function adminGuestTeams(
  db: Db,
  eventId: EventId,
): Promise<AdminGuestTeam[]> {
  return db
    .select({
      id: guestTeam.id,
      name: guestTeam.name,
      captainName: guestTeam.captainName,
      captainEmail: guestTeam.captainEmail,
      rosterSize: guestTeam.rosterSize,
      linkToken: guestTeam.linkToken,
      signed: sql<number>`count(${guestWaiverSignature.id})::int`,
      createdAt: guestTeam.createdAt,
    })
    .from(guestTeam)
    .leftJoin(
      guestWaiverSignature,
      eq(guestWaiverSignature.guestTeamId, guestTeam.id),
    )
    .where(eq(guestTeam.eventId, eventId))
    .groupBy(guestTeam.id)
    .orderBy(asc(guestTeam.createdAt), asc(guestTeam.name));
}

export type TeamRemoveError = "no_team" | "in_bracket";

/** Removes a guest team and its signatures, unless the bracket has it. */
export async function removeGuestTeam(
  db: Db,
  input: { leagueId: LeagueId; eventId: EventId; teamId: GuestTeamId; actorId: UserId },
): Promise<Result<void, TeamRemoveError>> {
  const locked = await lockTournament(db, input.eventId);
  if (!locked) return err("no_team");
  if (locked.t.bracket && teamsIn(locked.t.bracket).has(input.teamId))
    return err("in_bracket");
  const [gone] = await db
    .delete(guestTeam)
    .where(and(eq(guestTeam.id, input.teamId), eq(guestTeam.eventId, input.eventId)))
    .returning({ name: guestTeam.name });
  if (!gone) return err("no_team");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "tournament.guest_team_remove",
    entityType: "tournament",
    entityId: input.eventId,
    leagueId: input.leagueId,
    before: { teamName: gone.name },
  });
  return ok(undefined);
}

export type BracketSaveError =
  | BracketError
  | "no_tournament"
  | "already_drawn"
  | "not_drawn"
  | "has_results";

/** Draws the bracket from the guest teams, in the given order of ids. */
export async function drawBracket(
  db: Db,
  input: {
    leagueId: LeagueId;
    eventId: EventId;
    /** Applied to the sign-up order, so a draw can be shuffled. */
    order: (teams: { id: string; name: string }[]) => { id: string; name: string }[];
    actorId: UserId;
  },
): Promise<Result<TournamentBracket, BracketSaveError>> {
  const locked = await lockTournament(db, input.eventId);
  if (!locked) return err("no_tournament");
  if (locked.t.bracket) return err("already_drawn");
  const teams = await db
    .select({ id: guestTeam.id, name: guestTeam.name })
    .from(guestTeam)
    .where(eq(guestTeam.eventId, input.eventId))
    .orderBy(asc(guestTeam.createdAt), asc(guestTeam.name));
  const made = makeBracket(input.order(teams));
  if (!made.ok) return made;
  await db
    .update(tournament)
    .set({ bracket: made.value })
    .where(eq(tournament.eventId, input.eventId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "tournament.bracket_draw",
    entityType: "tournament",
    entityId: input.eventId,
    leagueId: input.leagueId,
    after: { seeds: made.value.seeds.map((s) => s.name) },
  });
  return made;
}

/** Throws the bracket away so it can be drawn again, if no game was played. */
export async function resetBracket(
  db: Db,
  input: { leagueId: LeagueId; eventId: EventId; actorId: UserId },
): Promise<Result<void, BracketSaveError>> {
  const locked = await lockTournament(db, input.eventId);
  if (!locked) return err("no_tournament");
  if (!locked.t.bracket) return err("not_drawn");
  if (hasResults(locked.t.bracket)) return err("has_results");
  await db
    .update(tournament)
    .set({ bracket: null })
    .where(eq(tournament.eventId, input.eventId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "tournament.bracket_reset",
    entityType: "tournament",
    entityId: input.eventId,
    leagueId: input.leagueId,
  });
  return ok(undefined);
}

/** Records a score (or a place) for one game of the bracket. */
export async function updateBracketGame(
  db: Db,
  input: {
    leagueId: LeagueId;
    eventId: EventId;
    code: string;
    change:
      | { kind: "score"; scoreA: number; scoreB: number }
      | { kind: "place"; place: string };
    actorId: UserId;
  },
): Promise<Result<TournamentBracket, BracketSaveError>> {
  const locked = await lockTournament(db, input.eventId);
  if (!locked) return err("no_tournament");
  const bracket = locked.t.bracket;
  if (!bracket) return err("not_drawn");
  const next =
    input.change.kind === "score"
      ? recordScore(bracket, input.code, input.change.scoreA, input.change.scoreB)
      : setPlace(bracket, input.code, input.change.place);
  if (!next.ok) return next;
  await db
    .update(tournament)
    .set({ bracket: next.value })
    .where(eq(tournament.eventId, input.eventId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: `tournament.game_${input.change.kind}`,
    entityType: "tournament",
    entityId: input.eventId,
    leagueId: input.leagueId,
    after: { code: input.code, ...input.change },
  });
  return next;
}

/* ---------- retention ---------- */

/**
 * Deletes guest teams, captains' contact details and waiver signatures
 * `guest_data_days` after the event ends (at once for an event an admin
 * deleted). The bracket stays: it holds team names and scores, nothing about
 * people. Returns how many tournaments were cleared. Safe to run twice.
 */
export async function purgeGuestData(db: Db, now: Date): Promise<number> {
  const rows = await db
    .select({
      eventId: tournament.eventId,
      guestDataDays: tournament.guestDataDays,
      guestDataDeletedAt: tournament.guestDataDeletedAt,
      endsAt: event.endsAt,
      deletedAt: event.deletedAt,
    })
    .from(tournament)
    .innerJoin(event, eq(event.id, tournament.eventId))
    .where(
      and(
        isNull(tournament.guestDataDeletedAt),
        // Ended, or deleted by an admin: the rest are not due yet.
        or(lte(event.endsAt, now), isNotNull(event.deletedAt)),
      ),
    );
  const due = rows.filter(
    (r) => r.deletedAt !== null || guestDataDue(r, r, now),
  );
  if (due.length === 0) return 0;
  const ids = due.map((r) => r.eventId);
  await db.delete(guestTeam).where(inArray(guestTeam.eventId, ids));
  await db
    .update(tournament)
    .set({ guestDataDeletedAt: now })
    .where(inArray(tournament.eventId, ids));
  return due.length;
}
