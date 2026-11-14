import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./index";

/**
 * Every table holds either one league's data or the platform's and its
 * people's (ADR 0048). A league's table carries `league_id`, or a required
 * foreign key to a table that is already a league's (a season, a team, a
 * game, a sponsor, an event...), so every row belongs to exactly one league
 * and every query can be scoped by it.
 *
 * A new table fails this test until it does one or the other. Adding it to
 * PLATFORM_TABLES is for data about a person or the platform as a whole,
 * never for anything about a season or a team.
 */
const PLATFORM_TABLES: Record<string, string> = {
  user: "a person's account, shared by every league they play in",
  session: "a signed-in device",
  account: "a sign-in method (email link, Google)",
  verification: "a pending sign-in link",
  passkey: "a person's passkey",
  rate_limit: "sign-in rate limits",
  profile: "a person's details, the same in every league",
  emergency_contact: "a person's emergency contact, shown per game",
  notification_preference: "a person's email choices",
  alert_setting: "a person's alert limits and quiet hours",
  push_subscription: "a person's phone",
  calendar_feed: "a person's private calendar link",
  referral_code: "a person's referral link",
  message: "a notice to one person, sent by the outbox",
  account_merge: "two accounts of one person merged by an admin",
  webhook_event: "a provider's webhook, before it is matched to a league",
  league: "the leagues themselves",
};

type Info = {
  name: string;
  leagueColumn: boolean;
  /** Tables this one points at through a NOT NULL foreign key. */
  requiredParents: string[];
  /** Every table this one points at. */
  parents: string[];
};

function tables(): Info[] {
  const found: Info[] = [];
  for (const table of Object.values(schema)) {
    if (!(table instanceof PgTable)) continue;
    const config = getTableConfig(table);
    const requiredParents: string[] = [];
    const parents: string[] = [];
    let leagueColumn = false;
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const parent = getTableConfig(ref.foreignTable).name;
      parents.push(parent);
      const required = ref.columns.every((c) => c.notNull);
      if (required) requiredParents.push(parent);
      if (parent === "league" && required) leagueColumn = true;
    }
    found.push({ name: config.name, leagueColumn, requiredParents, parents });
  }
  return found;
}

/** The tables whose every row belongs to one league. */
function leagueScoped(all: Info[]): Set<string> {
  const scoped = new Set<string>(["league"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of all) {
      if (scoped.has(t.name)) continue;
      if (t.leagueColumn || t.requiredParents.some((p) => scoped.has(p))) {
        scoped.add(t.name);
        grew = true;
      }
    }
  }
  scoped.delete("league");
  return scoped;
}

describe("league scoping", () => {
  const all = tables();
  const scoped = leagueScoped(all);

  it("scopes every table to a league, or lists it as the platform's", () => {
    const unscoped = all
      .map((t) => t.name)
      .filter((name) => !scoped.has(name) && !(name in PLATFORM_TABLES));
    // A table about seasons, teams or anything a league owns needs league_id,
    // or a required foreign key to a table that has it.
    expect(unscoped).toEqual([]);
  });

  it("keeps the platform list honest", () => {
    const names = new Set(all.map((t) => t.name));
    expect(Object.keys(PLATFORM_TABLES).filter((n) => !names.has(n))).toEqual(
      [],
    );
    expect(Object.keys(PLATFORM_TABLES).filter((n) => scoped.has(n))).toEqual(
      [],
    );
  });

  it("finds the league's main tables scoped", () => {
    for (const name of [
      "season",
      "team",
      "team_season",
      "game",
      "registration",
      "sponsor",
      "event",
      "expense",
      "league_member",
      "audit_log",
      "purchase",
      "credit_entry",
    ])
      expect(scoped.has(name), name).toBe(true);
    expect(scoped.size).toBeGreaterThan(60);
  });
});
