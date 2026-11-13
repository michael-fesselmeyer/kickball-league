import type { SeasonId, TeamId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { EventKind } from "./event";

/**
 * Who an event is for (docs/product-spec.md, section 9, "Events, content and
 * community"): everyone, all members, or chosen teams from one season or
 * from any. The same rules decide who sees an event and who is told about
 * it. Pure, so they are tested without a database; the database's recipient
 * query is tested against them.
 */

export const AUDIENCE_KINDS = ["public", "members", "teams"] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

export const AUDIENCE_LABELS: Readonly<Record<AudienceKind, string>> = {
  public: "Everyone",
  members: "All members",
  teams: "Chosen teams",
};

export type Audience =
  | { kind: "public" }
  | { kind: "members" }
  | {
      kind: "teams";
      /** The season whose rosters count; null for any season. */
      seasonId: SeasonId | null;
      teamIds: readonly TeamId[];
    };

export const PUBLIC: Audience = { kind: "public" };

/** The person looking, or null for a signed-out visitor. */
export type Viewer = {
  /** Admins and owners see every event. */
  staff: boolean;
  /** Registered (and not cancelled or refunded) in any of the league's seasons. */
  member: boolean;
  /** Active roster spots: the team and the season of each. */
  teams: readonly { teamId: TeamId; seasonId: SeasonId }[];
} | null;

/** Whether the viewer is one of the people the event is for. */
function inAudience(audience: Audience, viewer: NonNullable<Viewer>): boolean {
  switch (audience.kind) {
    case "public":
    case "members":
      return viewer.member;
    case "teams":
      return viewer.teams.some(
        (spot) =>
          audience.teamIds.includes(spot.teamId) &&
          (audience.seasonId === null || audience.seasonId === spot.seasonId),
      );
  }
}

/**
 * Whether someone may see an event: anyone for a public one; otherwise the
 * people it is for, and the league's admins.
 */
export function canSee(audience: Audience, viewer: Viewer): boolean {
  if (audience.kind === "public") return true;
  if (viewer === null) return false;
  return viewer.staff || inAudience(audience, viewer);
}

/**
 * Whether someone is told when an admin announces the event. A public event
 * is announced to all members; admins are told only when it is for them.
 */
export function isTold(audience: Audience, viewer: Viewer): boolean {
  return viewer !== null && inAudience(audience, viewer);
}

/** "Everyone", "All members", or "Sun Kickers and Foul Play, Fall 2026". */
export function audienceLine(
  audience: Audience,
  names: { teams: readonly string[]; season: string | null },
): string {
  if (audience.kind !== "teams") return AUDIENCE_LABELS[audience.kind];
  const teams =
    names.teams.length <= 1
      ? (names.teams[0] ?? "No teams")
      : `${names.teams.slice(0, -1).join(", ")} and ${names.teams.at(-1)}`;
  return `${teams}, ${names.season ?? "any season"}`;
}

/** Who it's for, in a shared message: null for a public event. */
export function audienceShareLine(
  audience: Audience,
  names: { teams: readonly string[]; season: string | null },
): string | null {
  if (audience.kind === "public") return null;
  if (audience.kind === "members") return "league members";
  return audienceLine(audience, names);
}

/** A short tag for lists: nothing for public events. */
export function audienceTag(audience: Audience): string | null {
  if (audience.kind === "public") return null;
  return audience.kind === "members" ? "Members only" : "Team event";
}

export const MAX_INVITE_URL_LENGTH = 500;

/**
 * An admin's invite link: https only, a real host name, no user name or
 * password in it. Blank means no link. The link is only shown and shared;
 * the server never fetches it.
 */
export function parseInviteUrl(raw: string): Result<string | null, "invite"> {
  const text = raw.trim();
  if (text === "") return ok(null);
  if (text.length > MAX_INVITE_URL_LENGTH || /\s/.test(text))
    return err("invite");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return err("invite");
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    // A name with a dot, such as partiful.com: not localhost or an address.
    !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*$/.test(host)
  )
    return err("invite");
  return url.href.length > MAX_INVITE_URL_LENGTH ? err("invite") : ok(url.href);
}

/** The invite's site, for its button: "partiful.com". */
export function inviteHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/** What the admin form sends about who an event is for, as strings. */
export type ReachForm = {
  audience: string;
  /** A season id, or "all" for any season. */
  season: string;
  teams: readonly string[];
  inviteUrl: string;
  /** "yes" when players also RSVP in the app. */
  inAppRsvp: string;
};

/** Who an event is for and how people RSVP, checked. */
export type Reach = {
  audience: Audience;
  inviteUrl: string | null;
  inAppRsvp: boolean;
};

/** The seasons and teams the form offers. */
export type AudienceChoices = {
  /** The season the form starts on; null when there is none to offer. */
  activeSeasonId: SeasonId | null;
  seasons: readonly {
    id: SeasonId;
    name: string;
    teams: readonly { id: TeamId; name: string }[];
  }[];
  /** Every team the league has, for "any season". */
  teams: readonly { id: TeamId; name: string }[];
};

export type ReachError = "invite" | "audience" | "season" | "teams";

export const REACH_ERRORS: Readonly<Record<ReachError, string>> = {
  invite:
    "Use a full https:// link for the invite, such as https://partiful.com/e/…, or leave it blank.",
  audience: "Pick who the event is for.",
  season: "Pick a season for the teams, or any season.",
  teams: "Pick at least one team from that season.",
};

const isAudienceKind = (value: string): value is AudienceKind =>
  (AUDIENCE_KINDS as readonly string[]).includes(value);

/**
 * Checks who an event is for. A theme week marks the public schedule, so it
 * is always public and has nothing to RSVP to; the rest of the form is
 * ignored for it.
 */
export function parseReach(
  form: ReachForm,
  kind: EventKind,
  choices: AudienceChoices,
): Result<Reach, ReachError> {
  const invite = parseInviteUrl(form.inviteUrl);
  if (!invite.ok) return invite;
  const inviteUrl = invite.value;
  if (kind === "theme_week")
    return ok({ audience: PUBLIC, inviteUrl, inAppRsvp: true });
  const inAppRsvp = form.inAppRsvp === "yes";
  const audience = form.audience.trim();
  if (!isAudienceKind(audience)) return err("audience");
  if (audience !== "teams")
    return ok({ audience: { kind: audience }, inviteUrl, inAppRsvp });

  let offered: readonly { id: TeamId }[];
  let seasonId: SeasonId | null = null;
  if (form.season === "all") offered = choices.teams;
  else {
    const season = choices.seasons.find((s) => s.id === form.season);
    if (!season) return err("season");
    seasonId = season.id;
    offered = season.teams;
  }
  const picked = new Set(form.teams);
  const teamIds = offered.filter((t) => picked.has(t.id)).map((t) => t.id);
  // Every pick has to be one the form offered for that season.
  if (teamIds.length === 0 || teamIds.length !== picked.size)
    return err("teams");
  return ok({
    audience: { kind: "teams", seasonId, teamIds },
    inviteUrl,
    inAppRsvp,
  });
}

/** A stored event's reach as the form's values, for editing. */
export function reachFormValues(
  reach: Reach,
  choices: Pick<AudienceChoices, "activeSeasonId">,
): ReachForm {
  const a = reach.audience;
  return {
    audience: a.kind,
    season:
      a.kind === "teams"
        ? (a.seasonId ?? "all")
        : (choices.activeSeasonId ?? "all"),
    teams: a.kind === "teams" ? [...a.teamIds] : [],
    inviteUrl: reach.inviteUrl ?? "",
    inAppRsvp: reach.inAppRsvp ? "yes" : "",
  };
}

/** The form's starting values for a new event: public, RSVPs in the app. */
export function blankReach(
  choices: Pick<AudienceChoices, "activeSeasonId">,
): ReachForm {
  return reachFormValues(
    { audience: PUBLIC, inviteUrl: null, inAppRsvp: true },
    choices,
  );
}

type SeasonForPick = {
  id: SeasonId;
  status: string;
  startsOn: string;
};

/**
 * The season the team picker starts on: the one being played, else the one
 * taking registrations (the soonest), else the latest one. Drafts never.
 */
export function activeSeasonOf(
  seasons: readonly SeasonForPick[],
): SeasonId | null {
  const live = seasons.filter((s) => s.status !== "draft");
  const latest = (list: readonly SeasonForPick[]) =>
    [...list].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0];
  const soonest = (list: readonly SeasonForPick[]) =>
    [...list].sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  const playing = latest(
    live.filter((s) => s.status === "in_progress" || s.status === "playoffs"),
  );
  const signingUp = soonest(
    live.filter(
      (s) =>
        s.status === "registration_open" || s.status === "registration_closed",
    ),
  );
  return (playing ?? signingUp ?? latest(live))?.id ?? null;
}
