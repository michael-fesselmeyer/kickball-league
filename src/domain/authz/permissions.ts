/**
 * Who can do what: the permissions matrix in docs/product-spec.md, section 5,
 * as data. Rights are the union of a person's global role (player, admin,
 * owner) and their scoped memberships (captain or co-captain of a team,
 * referee of assigned games, member of a sponsor). Every signed-in person is
 * at least a player.
 */

export type GlobalRole = "player" | "admin" | "owner";
export type RosterRole = "captain" | "co_captain" | "player";

export type Subject = {
  /** Null for a visitor who is not signed in. */
  userId: string | null;
  globalRole: GlobalRole | null;
  /** Active roster memberships. */
  roster: readonly { teamSeasonId: string; role: RosterRole }[];
  /** Approved as a referee for the season. */
  isReferee: boolean;
  /** Games this person referees. */
  refereeGameIds: readonly string[];
  /** Sponsors this person manages. */
  sponsorIds: readonly string[];
};

/** What an action is about. Each action reads only the fields it needs. */
export type Context = {
  /** The person acted on, for "own" rules. */
  targetUserId?: string;
  /** The team concerned. */
  teamSeasonId?: string;
  /** The roster role of the member acted on. */
  targetRole?: RosterRole;
  game?: { id: string; teamSeasonIds: readonly [string, string] };
  sponsorId?: string;
  /** For contact details: the member chose to share them with their team. */
  memberOptedIn?: boolean;
  /** For claiming a sub request: registered, waiver signed, not suspended. */
  eligibleToSub?: boolean;
  /** For announcements. */
  scope?: "team" | "league";
};

type Rule = (s: Subject, c: Context) => boolean;

const signedIn: Rule = (s) => s.userId !== null;
const isAdmin: Rule = (s) =>
  s.globalRole === "admin" || s.globalRole === "owner";
const isOwner: Rule = (s) => s.globalRole === "owner";
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
const captainsGame: Rule = (s, c) =>
  c.game !== undefined && c.game.teamSeasonIds.some((t) => captains(s, t));
const refereesGame: Rule = (s, c) =>
  c.game !== undefined && s.refereeGameIds.includes(c.game.id);
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
  // Any signed-in person
  "registration.join": signedIn,
  "team.register": signedIn,
  "team.request_new": signedIn,
  "event.rsvp": signedIn,
  "sponsor.check_in": signedIn,
  "sub_request.claim": (s, c) => signedIn(s, c) && c.eligibleToSub === true,
  "awards.vote": (s) => s.roster.length > 0,
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
  // Captains, of their own team
  "roster.manage": any(isAdmin, (s, c) => {
    if (!captains(s, c.teamSeasonId)) return false;
    // A co-captain has the captain's rights except removing the captain.
    const mine = s.roster.find((m) => m.teamSeasonId === c.teamSeasonId);
    return !(mine?.role === "co_captain" && c.targetRole === "captain");
  }),
  "sub_request.post": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  "conflicts.submit": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  // Cash or Venmo paid outside the app (product-spec.md, section 9).
  "payment.record_offline": any(isAdmin, (s, c) => captains(s, c.teamSeasonId)),
  "score.enter": any(isAdmin, captainsGame, refereesGame),
  "score.confirm": any(isAdmin, captainsGame),
  "announcement.send": any(
    isAdmin,
    (s, c) => c.scope === "team" && captains(s, c.teamSeasonId),
  ),
  // Referees
  "referee.availability": all(signedIn, (s) => s.isReferee),
  "referee.earnings": all(signedIn, (s) => s.isReferee),
  "incident.log": any(isAdmin, refereesGame),
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
  "rainout.declare": isAdmin,
  "free_agents.place": isAdmin,
  "event.manage": isAdmin,
  "referee.manage": isAdmin,
  "player.suspend": isAdmin,
  "refund.issue": isAdmin,
  "audit.read": isAdmin,
  // The owner alone
  "billing.manage": isOwner,
  "admins.manage": isOwner,
} satisfies Record<string, Rule>;

export type Action = keyof typeof RULES;

export const ACTIONS = Object.keys(RULES) as Action[];

/** Whether `subject` may do `action` in `context`. */
export function can(
  subject: Subject,
  action: Action,
  context: Context = {},
): boolean {
  return RULES[action](subject, context);
}

/** A visitor who is not signed in. */
export const VISITOR: Subject = {
  userId: null,
  globalRole: null,
  roster: [],
  isReferee: false,
  refereeGameIds: [],
  sponsorIds: [],
};
