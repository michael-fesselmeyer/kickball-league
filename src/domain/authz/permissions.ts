/**
 * Who can do what: the permissions matrix in docs/product-spec.md, section 5,
 * as data. Rights are the union of a person's role in one league (player,
 * admin, owner) and their scoped memberships there (captain or co-captain of
 * a team, referee of assigned games, member of a sponsor). Every signed-in
 * person is at least a player.
 *
 * A subject is always loaded for one league (ADR 0048): its role, teams,
 * games and sponsors are that league's only. An action about a record in
 * another league (`context.leagueId`) is refused whatever the role, so an
 * admin of one league has no rights in another.
 */

import { type ActingPower, actingPowersOpen } from "./acting-admin";

export type GlobalRole = "player" | "admin" | "owner";
export type RosterRole = "captain" | "co_captain" | "player";

export type Subject = {
  /** Null for a visitor who is not signed in. */
  userId: string | null;
  /** The league this subject was loaded for; null for a visitor. */
  leagueId: string | null;
  /** The person's role in that league. */
  globalRole: GlobalRole | null;
  /** Active roster memberships. */
  roster: readonly { teamSeasonId: string; role: RosterRole }[];
  /** Approved as a referee for the season. */
  isReferee: boolean;
  /** Games this person referees. */
  refereeGameIds: readonly string[];
  /** Sponsors this person manages. */
  sponsorIds: readonly string[];
  /**
   * The platform operator (ADR 0009), set from the server's environment by
   * the page or action that asks. Above the owners: what the owners alone
   * may see, the operator may see too.
   */
  isOperator?: boolean;
  /**
   * Powers an owner handed over for dates that include now (issue #468),
   * for a player only. They open exactly the actions their powers list
   * (acting-admin.ts), as an admin would, and never a role change.
   */
  acting?: readonly ActingPower[];
};

/** What an action is about. Each action reads only the fields it needs. */
export type Context = {
  /**
   * The league of the record acted on. When it isn't the subject's league,
   * every action is refused.
   */
  leagueId?: string;
  /** The person acted on, for "own" rules. */
  targetUserId?: string;
  /** The team concerned. */
  teamSeasonId?: string;
  /** The roster role of the member acted on. */
  targetRole?: RosterRole;
  /**
   * The league role of the person acted on. An acting admin may not act on
   * an admin or an owner (issue #468).
   */
  targetGlobalRole?: GlobalRole;
  game?: {
    id: string;
    teamSeasonIds: readonly [string, string];
    /** For live scoring: a ref has accepted the game. */
    hasReferee?: boolean;
    /** It is the game's day (or later) in the league's time zone. */
    gameDay?: boolean;
  };
  sponsorId?: string;
  /** For contact details: the member chose to share them with their team. */
  memberOptedIn?: boolean;
  /** For claiming a sub request: registered, waiver signed, not suspended. */
  eligibleToSub?: boolean;
  /** For announcements. */
  scope?: "team" | "league";
  /**
   * For confirming a rain-out: the owners let admins confirm too, for days
   * no owner is around (ADR 0057). Read from the league's setting.
   */
  adminsConfirmRainouts?: boolean;
  /**
   * The person leads set-up for the game day concerned: they claimed its
   * set-up lead volunteer shift (issue #409). Read from their signups.
   */
  setupLead?: boolean;
};

type Rule = (s: Subject, c: Context) => boolean;

/**
 * Whether the person's own role in the league is admin or owner. Unlike a
 * permission such as "score.override", it is not granted to someone acting
 * with limited admin powers, so use it where only a real admin may act.
 */
export const hasAdminRole = (s: Subject): boolean =>
  s.globalRole === "admin" || s.globalRole === "owner";
const signedIn: Rule = (s) => s.userId !== null;
const isAdmin: Rule = (s) => hasAdminRole(s);
/**
 * Belongs to the league: has a place in it (a team, the ref pool or a
 * sponsor) or runs it. A signed-in account with none of these is not a
 * member, whatever role the loader gives it.
 */
const inLeague: Rule = (s) =>
  s.userId !== null &&
  s.leagueId !== null &&
  (s.globalRole === "admin" ||
    s.globalRole === "owner" ||
    s.roster.length > 0 ||
    s.isReferee ||
    s.sponsorIds.length > 0);
const isOwner: Rule = (s) => s.globalRole === "owner";
/** An acting admin whose handover includes `power`. */
const actsFor =
  (power: ActingPower): Rule =>
  (s) =>
    s.userId !== null && s.acting?.includes(power) === true;
const isOperator: Rule = (s) => s.userId !== null && s.isOperator === true;
const self: Rule = (s, c) => s.userId !== null && c.targetUserId === s.userId;
const onTeam = (s: Subject, team: string | undefined) =>
  team !== undefined && s.roster.some((m) => m.teamSeasonId === team);
const captains = (s: Subject, team: string | undefined) =>
  team !== undefined &&
  s.roster.some(
    (m) =>
      m.teamSeasonId === team &&
      (m.role === "captain" || m.role === "co_captain"),
  );
/** The team's one captain, not a co-captain. */
const leads = (s: Subject, team: string | undefined) =>
  team !== undefined &&
  s.roster.some((m) => m.teamSeasonId === team && m.role === "captain");
const captainsGame: Rule = (s, c) =>
  c.game !== undefined && c.game.teamSeasonIds.some((t) => captains(s, t));
const refereesGame: Rule = (s, c) =>
  c.game !== undefined && s.refereeGameIds.includes(c.game.id);
/** Leads set-up for the game day concerned (issue #409). */
const leadsSetup: Rule = (s, c) => s.userId !== null && c.setupLead === true;
const any =
  (...rules: Rule[]): Rule =>
  (s, c) =>
    rules.some((rule) => rule(s, c));
const all =
  (...rules: Rule[]): Rule =>
  (s, c) =>
    rules.every((rule) => rule(s, c));

const RULES = {
  // Everyone
  "public.view": () => true,
  "roster.view_names": () => true,
  // Any signed-in person, about themselves
  "profile.edit": self,
  "waiver.sign": self,
  "payment.pay_own": self,
  "data.export_or_delete": any(self, isOwner),
  // Quietly say you're open to a new team next season, answer the invites
  // it gets, or withdraw it (ADR 0089). Only the person themselves.
  "move.set": self,
  // Any signed-in person
  "registration.join": signedIn,
  "team.register": signedIn,
  "team.request_new": signedIn,
  /** Ask the league for a private league or tournament (ADR 0049). */
  "private_event.request": signedIn,
  /** A private event's organizer page: its organizer (the target) or an admin. */
  "private_event.organize": any(isAdmin, self),
  "event.rsvp": signedIn,
  "sponsor.check_in": signedIn,
  // Scan a game's field check-in code (ADR 0063); being on either roster or
  // approved to sub in that game is checked with it.
  "attendance.check_in": signedIn,
  // A free giveaway at an event; the event's audience narrows it further.
  "giveaway.enter": signedIn,
  // The sign-up challenge's leaderboard: team names and percentages only.
  "challenge.view": signedIn,
  // Buy from the league shop, for themselves.
  "merch.order": signedIn,
  // Take and give back a spot on a volunteer shift.
  "volunteer.claim": signedIn,
  // A season's survey; being on a roster that season is checked with it.
  "survey.answer": signedIn,
  "sub_request.claim": (s, c) => signedIn(s, c) && c.eligibleToSub === true,
  "awards.vote": (s) => s.roster.length > 0,
  // Pick'em, for bragging rights only (ADR 0044).
  "pickem.pick": signedIn,
  // Photos for the league's socials: anyone on a team, and admins. What
  // they may tag is checked against their own teams, games and events.
  "photos.upload": any(isAdmin, (s) => s.roster.length > 0),
  // The uploader deletes their own photo at any time.
  "photos.delete_own": self,
  // The lost and found board: post, answer and write in a conversation
  // (issue #385), members only. Whose conversation it is is checked with
  // the data.
  "lost_found.use": inLeague,
  // Players on a team
  "rsvp.set": (s, c) => self(s, c) && onTeam(s, c.teamSeasonId),
  "rsvp.view_team": any(isAdmin, (s, c) => onTeam(s, c.teamSeasonId)),
  "roster.view_status": any(
    isAdmin,
    (s, c) => captains(s, c.teamSeasonId),
    self,
  ),
  "roster.view_contacts": any(
    isAdmin,
    (s, c) => captains(s, c.teamSeasonId),
    (s, c) => onTeam(s, c.teamSeasonId) && c.memberOptedIn === true,
    // A referee may reach the captains of the games they referee.
    (s, c) =>
      (c.targetRole === "captain" || c.targetRole === "co_captain") &&
      refereesGame(s, c) &&
      c.teamSeasonId !== undefined &&
      c.game?.teamSeasonIds.includes(c.teamSeasonId) === true,
  ),
  "opposing_captain.view_contact": any(isAdmin, captainsGame, refereesGame),
  // A team's own sign-up progress, for everyone on it.
  "challenge.view_team": any(isAdmin, (s, c) => onTeam(s, c.teamSeasonId)),
  // Captains, of their own team
  "roster.manage": any(isAdmin, (s, c) => {
    if (!captains(s, c.teamSeasonId)) return false;
    // A co-captain has the captain's rights except removing the captain.
    const mine = s.roster.find((m) => m.teamSeasonId === c.teamSeasonId);
    return !(mine?.role === "co_captain" && c.targetRole === "captain");
  }),
  // Hand the team to a teammate, and make or unmake co-captains (ADR 0042):
  // the team's captain only, never a co-captain, and admins.
  "captaincy.manage": any(isAdmin, (s, c) => leads(s, c.teamSeasonId)),
  // Accept or decline the captaincy offered to you, or step down as a
  // co-captain: only the person themselves.
  "captaincy.respond": self,
  "sub_request.post": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  // Approve or decline claims, or take the request down.
  "sub_request.decide": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  // Who is playing as a pickup: both captains and the ref, as the rulebook asks.
  "sub_request.view_pickups": any(isAdmin, captainsGame, refereesGame),
  // Emergency contacts, on game day only (src/domain/emergency): the game's
  // captains and ref, and nobody else, admins included.
  "emergency_contact.view": any(captainsGame, refereesGame),
  "conflicts.submit": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  // Cash or Venmo paid outside the app (product-spec.md, section 9).
  "payment.record_offline": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  // A saved card that guarantees the team's balance (roadmap item 13). Only
  // the team's own captains: an admin never saves a card for someone.
  "guarantee.manage": (s, c) => captains(s, c.teamSeasonId),
  // CSV files of a roster or its payments. Without a team: the whole season.
  "roster.export": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  "payments.export": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  "score.enter": any(isAdmin, captainsGame, refereesGame),
  // The park permit for a game, at the field: its ref and both captains.
  // Admins manage permit windows but never see the permit's document.
  "permit.view_at_field": any(
    isOwner,
    isOperator,
    captainsGame,
    refereesGame,
    leadsSetup,
  ),
  // The game-day checklist (issue #409). A captain ticks their own team's
  // items; the set-up lead records park users asked to move and confirms
  // set-up; the field's ref, a captain or the set-up lead confirms it was
  // left clean after the last game.
  "game_checklist.tick": (s, c) => captains(s, c.teamSeasonId),
  "move_request.record": leadsSetup,
  "field_check.setup": any(isAdmin, leadsSetup),
  "field_check.close": any(isAdmin, captainsGame, refereesGame, leadsSetup),
  "score.confirm": any(isAdmin, captainsGame),
  // "I'm at the field": the game's ref on game day, or an admin for them.
  "referee.check_in": any(
    isAdmin,
    all(refereesGame, (_, c) => c.game?.gameDay === true),
  ),
  // Inning by inning: the ref, or a captain when the game has no ref.
  "score.live": any(
    isAdmin,
    refereesGame,
    all(captainsGame, (_, c) => c.game?.hasReferee === false),
  ),
  // Build and save a team's kicking order, seeing its players' lineup genders.
  "lineup.edit": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  // See a saved order, names only: from game day, both captains and the ref.
  "lineup.view_order": any(
    isAdmin,
    (s, c) => captains(s, c.teamSeasonId),
    all(any(captainsGame, refereesGame), (_, c) => c.game?.gameDay === true),
  ),
  "announcement.send": any(
    isAdmin,
    (s, c) => c.scope === "team" && captains(s, c.teamSeasonId),
  ),
  // Referees
  "referee.availability": all(signedIn, (s) => s.isReferee),
  "referee.earnings": all(signedIn, (s) => s.isReferee),
  // Game-day discipline: the game's ref, a captain of either team or an
  // admin files a report; only admins review it and suspend.
  "incident.log": any(isAdmin, refereesGame, captainsGame),
  // Eject a player from the live game screen: the game's ref, or an admin.
  "player.eject": any(isAdmin, refereesGame),
  // A yellow or red card, a calm-down tool: the game's ref or an admin.
  "card.give": any(isAdmin, refereesGame),
  // Field check-in (ADR 0063): show the game's code and tick players in or
  // out, with each one's waiver status. The game's ref, its captains, admins.
  "attendance.take": any(isAdmin, refereesGame, captainsGame),
  // A team's attendance and games played: its captains, and admins.
  "attendance.view": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  // A captain rates the other team once the game is final.
  "sportsmanship.rate": captainsGame,
  // A team's own average, for its captains.
  "sportsmanship.view_own": (s, c) => captains(s, c.teamSeasonId),
  // A private "not on my team" list (ADR 0036): a team's captains for their
  // own team, admins for any team. The person listed never sees it.
  "keep_off.manage": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  // Looking for a change (ADR 0089): invite every player open to a move,
  // unseen, to a team recruiting for next season. A team's captains only,
  // never admins on its behalf; who they see is decided by the queries,
  // which never count a team's own players.
  "move.recruit": (s, c) => captains(s, c.teamSeasonId),
  // League gear (issue #286): picking up, handing on, returning and
  // reporting a kit, by the person themselves. Whether they have the kit
  // or bring it to a game is checked against the kit (src/domain/equipment).
  "equipment.carry": self,
  // Sponsors
  "sponsor.edit": any(isAdmin, (s, c) =>
    c.sponsorId !== undefined ? s.sponsorIds.includes(c.sponsorId) : false,
  ),
  "sponsor.report": any(isAdmin, (s, c) =>
    c.sponsorId !== undefined ? s.sponsorIds.includes(c.sponsorId) : false,
  ),
  // Admins and the owner
  "score.override": isAdmin,
  "season.manage": isAdmin,
  "schedule.manage": isAdmin,
  // Open the rain-out screen, preview the makeups and send a rain-out to
  // the owners to confirm (ADR 0057).
  "rainout.prepare": isAdmin,
  // Write a season's game-day checklist and move script (issue #409).
  "game_checklist.manage": isAdmin,
  // Cancel the day and save the makeups as a draft: the owners and the
  // operator, and admins too when the owners allow it.
  "rainout.confirm": any(
    isOwner,
    isOperator,
    (s, c) => isAdmin(s, c) && c.adminsConfirmRainouts === true,
    // An owner who handed over rain-outs chose this, so it needs no setting.
    actsFor("rainouts"),
  ),
  // Set a game day's status: on, watching, delayed or off (issue #383).
  "game_day.status": isAdmin,
  "free_agents.place": isAdmin,
  "team.approve_new": isAdmin,
  "event.manage": isAdmin,
  "private_event.manage": isAdmin,
  "giveaway.manage": isAdmin,
  "challenge.manage": isAdmin,
  "volunteer.manage": isAdmin,
  // Interest forms for a new night, park or format, their totals and the go-ahead.
  "interest.manage": isAdmin,
  "survey.manage": isAdmin,
  // A survey's totals and anonymous comments; never who said what.
  "survey.results": isAdmin,
  "referee.manage": isAdmin,
  "player.suspend": isAdmin,
  "incident.review": isAdmin,
  // An injury report holds health details: read, exported and deleted by
  // owners and admins only, never by the people who filed it (ADR 0064).
  "injury.read": isAdmin,
  "injury.delete": isAdmin,
  // The concerns queue: private player concerns and public contact messages.
  "concern.review": isAdmin,
  // A signed-in player sends a private concern and reads their own.
  "concern.send": signedIn,
  "sportsmanship.view": isAdmin,
  // Every team's list and reasons, to catch misuse.
  "keep_off.review": isAdmin,
  // Who is looking for a change, with notes, when they let admins see it.
  "move.review": isAdmin,
  "refund.issue": isAdmin,
  // Merge a duplicate account into another (ADR 0041).
  "accounts.merge": isAdmin,
  "audit.read": isAdmin,
  // The demo's mail page and its reset, and only while demo mode is on
  // (docs/adr/0052-local-demo-runs-offline.md).
  "demo.manage": isAdmin,
  "shirts.manage": isAdmin,
  // The win-back list: email past players while registration is open.
  "win_back.manage": isAdmin,
  "awards.manage": isAdmin,
  // Quick polls for captains (ADR 0063): admins ask, a team's captains answer.
  "captain_polls.manage": isAdmin,
  "captain_polls.vote": (s, c) =>
    c.teamSeasonId === undefined
      ? s.roster.some((m) => m.role === "captain" || m.role === "co_captain")
      : captains(s, c.teamSeasonId),
  "pickem.manage": isAdmin,
  "photos.manage": isAdmin,
  // Take any post off the lost and found board.
  "lost_found.manage": isAdmin,
  // The shop's catalog, its orders, the printer's CSV and fulfillment.
  "merch.manage": isAdmin,
  "friends.manage": isAdmin,
  // Kits, who brings them to which game, and where they are.
  "equipment.manage": isAdmin,
  // The season ops checklist: see it, assign, date and tick off tasks.
  "checklist.manage": isAdmin,
  // The league's rules and their change log (ADR 0062).
  "rules.manage": isAdmin,
  // Importing the rulebook and choosing who may read it (ADR 0086).
  "rulebook.manage": any(isOwner, isOperator),
  // The owner alone
  "billing.manage": isOwner,
  // The books (expenses, receipts, permit costs and documents, insurance).
  "books.manage": any(isOwner, isOperator),
  // The owner dashboard: membership, money in and out, completion, turnout.
  "dashboard.view": any(isOwner, isOperator),
  // Publish or take down a season's money summary (ADR 0038).
  "money_summary.publish": any(isOwner, isOperator),
  // The ops checklist template every season starts from (ADR 0061).
  "checklist.template": any(isOwner, isOperator),
  "admins.manage": isOwner,
  // Whether a person's own data export lists entries about them (ADR 0036).
  "keep_off.export_policy": isOwner,
  // Whether admins may confirm rain-outs too (ADR 0057).
  "rainout.confirm_policy": isOwner,
} satisfies Record<string, Rule>;

export type Action = keyof typeof RULES;

export const ACTIONS = Object.keys(RULES) as Action[];

/** Whether `subject` may do `action` in `context`. */
/** Actions that change a game's score; an acting admin may not use them on their own game. */
const SCORE_ACTIONS: ReadonlySet<Action> = new Set([
  "score.enter",
  "score.confirm",
  "score.override",
  "score.live",
]);

export function can(
  subject: Subject,
  action: Action,
  context: Context = {},
): boolean {
  if (
    context.leagueId !== undefined &&
    subject.leagueId !== null &&
    context.leagueId !== subject.leagueId
  )
    return false;
  const rule = RULES[action];
  if (rule(subject, context)) return true;
  // An acting admin is a player with an admin's rights for the listed
  // actions only: the rule runs again as an admin when a power opens it.
  if (
    subject.globalRole === "player" &&
    subject.userId !== null &&
    actingPowersOpen(subject.acting, action)
  ) {
    // Never on themselves, on staff, or on a game they play in.
    if (context.targetUserId === subject.userId) return false;
    if (
      context.targetGlobalRole === "admin" ||
      context.targetGlobalRole === "owner"
    )
      return false;
    if (
      SCORE_ACTIONS.has(action) &&
      context.game?.teamSeasonIds.some((t) => onTeam(subject, t))
    )
      return false;
    return rule({ ...subject, globalRole: "admin" }, context);
  }
  return false;
}

/** A visitor who is not signed in. */
export const VISITOR: Subject = {
  userId: null,
  leagueId: null,
  globalRole: null,
  roster: [],
  isReferee: false,
  refereeGameIds: [],
  sponsorIds: [],
};
