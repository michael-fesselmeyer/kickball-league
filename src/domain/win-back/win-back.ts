import type { UserId } from "../ids";

/**
 * Inviting past players back while a season's registration is open
 * (issue #370). Pure: who is on the list and in what order, the email's
 * wording from the league's template, and where its button goes.
 */

/** How many seasons back the list looks, counting the one just before. */
export const LOOKBACK_SEASONS = 3;

export const DEFAULT_SUBJECT = "We saved you a spot for {season}";
export const DEFAULT_BODY = `Hi {first_name},

{season} registration is open, and the league isn't the same without you. Last time you played with {team}.

Grab your spot before the teams fill up. We'd love to see you back on the field.`;

/** The words a template may use, filled in for each player. */
export const PLACEHOLDERS = ["first_name", "season", "team"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** Fills `{first_name}`, `{season}` and `{team}`; other braces stay as typed. */
export function fill(
  text: string,
  values: Readonly<Record<Placeholder, string>>,
): string {
  return text.replace(
    /\{(first_name|season|team)\}/g,
    (_, key: Placeholder) => values[key],
  );
}

/** Paragraphs from the body: blank lines split them. */
export const paragraphsOf = (body: string): string[] =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

export type TemplateProblem = "subject" | "body";

/** An admin's edit of the template, checked. */
export function parseTemplate(input: {
  subject: string;
  body: string;
}):
  | { ok: true; value: { subject: string; body: string } }
  | { ok: false; error: TemplateProblem } {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < 1 || subject.length > 120)
    return { ok: false, error: "subject" };
  if (body.length < 1 || body.length > 2000)
    return { ok: false, error: "body" };
  return { ok: true, value: { subject, body } };
}

/** How the player last took part: it decides the email's button. */
export type LastRole = "captain" | "player" | "free_agent";

/**
 * A past captain gets a link to register their team, a free agent the
 * free-agent page, and everyone else the season's page to join a team.
 */
export function invitePath(
  role: LastRole,
  seasonSlug: string,
): { path: string; label: string } {
  if (role === "captain")
    return {
      path: `/app/seasons/${seasonSlug}/register`,
      label: "Register your team",
    };
  if (role === "free_agent")
    return { path: "/free-agents", label: "Sign up as a free agent" };
  return { path: `/app/seasons/${seasonSlug}`, label: "Sign up" };
}

export type Candidate = {
  userId: UserId;
  firstName: string;
  name: string;
  /** Seasons with a registration, of every season the league has run. */
  seasonsPlayed: number;
  /** The most recent season they played, its start (YYYY-MM-DD) and name. */
  lastSeasonStart: string;
  lastSeasonName: string;
  /** Their team that season, or null when they never joined one. */
  lastTeam: string | null;
  lastRole: LastRole;
  /** They turned off league news (announcements) by email. */
  optedOut: boolean;
  /** When this season's win-back email was queued for them, if it was. */
  emailedAt: Date | null;
};

export type CandidateState = "ready" | "emailed" | "opted_out";

export const stateOf = (c: Candidate): CandidateState =>
  c.emailedAt ? "emailed" : c.optedOut ? "opted_out" : "ready";

/**
 * Most loyal first: more seasons played, then the most recent season, then
 * by name, so the list reads the same on every visit.
 */
export function rankCandidates(rows: readonly Candidate[]): Candidate[] {
  return [...rows].sort(
    (a, b) =>
      b.seasonsPlayed - a.seasonsPlayed ||
      (a.lastSeasonStart < b.lastSeasonStart
        ? 1
        : a.lastSeasonStart > b.lastSeasonStart
          ? -1
          : 0) ||
      a.name.localeCompare(b.name),
  );
}

/** The longest subject the win-back email takes (src/emails/win-back.ts). */
export const SUBJECT_MAX = 200;

/** The email for one player, from the league's template. */
export function winBackMessage(
  template: { subject: string; body: string },
  c: Pick<Candidate, "firstName" | "lastTeam" | "lastRole">,
  season: { name: string; slug: string },
) {
  const values = {
    first_name: c.firstName,
    season: season.name,
    team: c.lastTeam ?? "the league",
  };
  const action = invitePath(c.lastRole, season.slug);
  const subject = fill(template.subject, values);
  return {
    // Long names can push a filled-in subject past what the email allows.
    subject:
      subject.length > SUBJECT_MAX
        ? `${subject.slice(0, SUBJECT_MAX - 1).trimEnd()}…`
        : subject,
    paragraphs: paragraphsOf(fill(template.body, values)),
    actionLabel: action.label,
    actionPath: action.path,
    seasonName: season.name,
  };
}
