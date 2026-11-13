/**
 * A captain's private "not on my team" list (product-spec.md, section 5;
 * ADR 0036). Pure rules; src/db/queries/keep-off.ts reads and writes the
 * rows, and the invite, matcher and sub finder ask it who is kept off.
 *
 * - The list keeps one person off one team, quietly. Their invite link to
 *   that team reads exactly like an expired one, the matcher never suggests
 *   the team, and they never see the team's sub requests. Nobody tells them.
 * - It never changes anything else: they register, join other teams, RSVP
 *   and sub for other teams as before. Safety problems go through incident
 *   reports and suspensions instead.
 * - Admins and owners see every list, so misuse shows: a team listing many
 *   people, or one person listed by several teams.
 */

import { err, ok, type Result } from "../result";

/** Longest private reason, in characters (the column's check matches). */
export const REASON_MAX = 300;

/** A team listing this many people or more is pointed out to admins. */
export const MANY_ON_ONE_LIST = 5;

/** The reason from a form: trimmed, empty as none, at most REASON_MAX. */
export function readReason(
  raw: unknown,
): Result<string | null, "reason_too_long"> {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length === 0) return ok(null);
  if (reason.length > REASON_MAX) return err("reason_too_long");
  return ok(reason);
}

/** An email address as typed, ready to look up, or null when it is not one. */
export function readEmail(raw: unknown): string | null {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null;
}

/**
 * What an invite link shows the person opening it. Someone the team keeps
 * off sees an expired link, word for word what anyone else sees for one, so
 * the page never hints at the list.
 */
export function inviteStateFor<S extends string>(
  state: S,
  keptOff: boolean,
): S | "expired" {
  return keptOff ? "expired" : state;
}

export type Entry = {
  teamId: string;
  teamName: string;
  userId: string;
  name: string;
};

export type Oversight = {
  /** Each team with a list, longest first, flagged at MANY_ON_ONE_LIST. */
  teams: { teamId: string; teamName: string; count: number; many: boolean }[];
  /** People on more than one team's list, most lists first. */
  people: { userId: string; name: string; teams: string[] }[];
};

/** What admins look for across every list: long lists, repeated names. */
export function oversight(entries: readonly Entry[]): Oversight {
  const teams = new Map<string, Oversight["teams"][number]>();
  const people = new Map<string, Oversight["people"][number]>();
  for (const e of entries) {
    const t = teams.get(e.teamId) ?? {
      teamId: e.teamId,
      teamName: e.teamName,
      count: 0,
      many: false,
    };
    t.count += 1;
    t.many = t.count >= MANY_ON_ONE_LIST;
    teams.set(e.teamId, t);
    const p = people.get(e.userId) ?? {
      userId: e.userId,
      name: e.name,
      teams: [],
    };
    if (!p.teams.includes(e.teamName)) p.teams.push(e.teamName);
    people.set(e.userId, p);
  }
  return {
    teams: [...teams.values()].sort(
      (a, b) => b.count - a.count || a.teamName.localeCompare(b.teamName),
    ),
    people: [...people.values()]
      .filter((p) => p.teams.length > 1)
      .map((p) => ({ ...p, teams: [...p.teams].sort() }))
      .sort(
        (a, b) =>
          b.teams.length - a.teams.length || a.name.localeCompare(b.name),
      ),
  };
}
