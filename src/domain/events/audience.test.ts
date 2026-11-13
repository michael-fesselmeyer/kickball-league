import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SeasonId, TeamId } from "@/domain/ids";
import {
  activeSeasonOf,
  type Audience,
  type AudienceChoices,
  audienceLine,
  audienceShareLine,
  audienceTag,
  blankReach,
  canSee,
  inviteHost,
  isTold,
  parseInviteUrl,
  parseReach,
  type ReachForm,
  reachFormValues,
  type Viewer,
} from "./audience";

const FALL = "5ea50000-0000-4000-8000-000000000001" as SeasonId;
const SUMMER = "5ea50000-0000-4000-8000-000000000002" as SeasonId;
const KICKERS = "7ea30000-0000-4000-8000-000000000001" as TeamId;
const FOULS = "7ea30000-0000-4000-8000-000000000002" as TeamId;
const DUCKS = "7ea30000-0000-4000-8000-000000000003" as TeamId;

const visitor: Viewer = null;
const signedUp: Viewer = { staff: false, member: false, teams: [] };
const member: Viewer = { staff: false, member: true, teams: [] };
const kicker: Viewer = {
  staff: false,
  member: true,
  teams: [{ teamId: KICKERS, seasonId: FALL }],
};
const pastFoul: Viewer = {
  staff: false,
  member: true,
  teams: [{ teamId: FOULS, seasonId: SUMMER }],
};
const admin: Viewer = { staff: true, member: false, teams: [] };

const fallTeams: Audience = {
  kind: "teams",
  seasonId: FALL,
  teamIds: [KICKERS, FOULS],
};
const anySeason: Audience = { ...fallTeams, seasonId: null };

describe("canSee", () => {
  it("shows a public event to everyone, signed in or not", () => {
    for (const viewer of [visitor, signedUp, member, kicker, admin])
      expect(canSee({ kind: "public" }, viewer)).toBe(true);
  });

  it("shows a members' event to members and admins, not to visitors or accounts that never signed up", () => {
    const members: Audience = { kind: "members" };
    expect(canSee(members, visitor)).toBe(false);
    expect(canSee(members, signedUp)).toBe(false);
    expect(canSee(members, member)).toBe(true);
    expect(canSee(members, admin)).toBe(true);
  });

  it("shows a team event to those teams' players in its season only", () => {
    expect(canSee(fallTeams, kicker)).toBe(true);
    // Played for a chosen team, but in another season.
    expect(canSee(fallTeams, pastFoul)).toBe(false);
    expect(canSee(fallTeams, member)).toBe(false);
    expect(canSee(fallTeams, visitor)).toBe(false);
    expect(canSee(fallTeams, admin)).toBe(true);
  });

  it("counts any season's roster when the event is for all seasons", () => {
    expect(canSee(anySeason, pastFoul)).toBe(true);
    expect(canSee(anySeason, kicker)).toBe(true);
    expect(
      canSee(anySeason, {
        staff: false,
        member: true,
        teams: [{ teamId: DUCKS, seasonId: FALL }],
      }),
    ).toBe(false);
  });

  it("never hides an event from someone it would tell, and never shows a private one to a visitor", () => {
    const team = fc.constantFrom(KICKERS, FOULS, DUCKS);
    const season = fc.constantFrom(FALL, SUMMER);
    const audience: fc.Arbitrary<Audience> = fc.oneof(
      fc.constant<Audience>({ kind: "public" }),
      fc.constant<Audience>({ kind: "members" }),
      fc.record({
        kind: fc.constant("teams" as const),
        seasonId: fc.option(season, { nil: null }),
        teamIds: fc.uniqueArray(team, { minLength: 1 }),
      }),
    );
    const viewer: fc.Arbitrary<Viewer> = fc.option(
      fc.record({
        staff: fc.boolean(),
        member: fc.boolean(),
        teams: fc.array(fc.record({ teamId: team, seasonId: season })),
      }),
      { nil: null },
    );
    fc.assert(
      fc.property(audience, viewer, (a, v) => {
        if (isTold(a, v)) expect(canSee(a, v)).toBe(true);
        if (v === null) expect(canSee(a, v)).toBe(a.kind === "public");
      }),
    );
  });
});

describe("isTold", () => {
  it("tells all members about a public or members' event, but no visitor", () => {
    for (const a of [{ kind: "public" }, { kind: "members" }] as const) {
      expect(isTold(a, member)).toBe(true);
      expect(isTold(a, signedUp)).toBe(false);
      expect(isTold(a, visitor)).toBe(false);
    }
  });

  it("tells a team event's players and not admins outside it", () => {
    expect(isTold(fallTeams, kicker)).toBe(true);
    expect(isTold(fallTeams, pastFoul)).toBe(false);
    expect(isTold(fallTeams, admin)).toBe(false);
    expect(isTold(anySeason, pastFoul)).toBe(true);
  });
});

describe("audience lines", () => {
  const names = { teams: ["Sun Kickers", "Foul Play"], season: "Fall 2026" };
  it("names the teams and the season", () => {
    expect(audienceLine(fallTeams, names)).toBe(
      "Sun Kickers and Foul Play, Fall 2026",
    );
    expect(
      audienceLine(anySeason, {
        teams: ["A", "B", "C"],
        season: null,
      }),
    ).toBe("A, B and C, any season");
    expect(audienceLine({ kind: "members" }, names)).toBe("All members");
  });

  it("tags private events in lists and leaves public ones alone", () => {
    expect(audienceTag({ kind: "public" })).toBeNull();
    expect(audienceTag({ kind: "members" })).toBe("Members only");
    expect(audienceTag(fallTeams)).toBe("Team event");
  });

  it("says who a shared event is for", () => {
    expect(audienceShareLine({ kind: "public" }, names)).toBeNull();
    expect(audienceShareLine({ kind: "members" }, names)).toBe(
      "league members",
    );
    expect(audienceShareLine(fallTeams, names)).toBe(
      "Sun Kickers and Foul Play, Fall 2026",
    );
  });
});

describe("parseInviteUrl", () => {
  it("takes an https link and leaves a blank one out", () => {
    expect(parseInviteUrl(" https://partiful.example.test/e/Prom27 ")).toEqual({
      ok: true,
      value: "https://partiful.example.test/e/Prom27",
    });
    expect(parseInviteUrl("")).toEqual({ ok: true, value: null });
  });

  it.each([
    "http://partiful.example.test/e/1",
    "javascript:alert(1)",
    "partiful.example.test/e/1",
    "https://localhost/e/1",
    "https://127.0.0.1/e/1",
    "https://someone:secret@partiful.example.test/e/1",
    "https://partiful.example.test/e/ two",
    `https://partiful.example.test/${"a".repeat(500)}`,
    "ftp://files.example.test/invite",
  ])("refuses %s", (raw) => {
    expect(parseInviteUrl(raw)).toEqual({ ok: false, error: "invite" });
  });

  it("names the invite's site for its button", () => {
    expect(inviteHost("https://www.partiful.example.test/e/1")).toBe(
      "partiful.example.test",
    );
    expect(inviteHost("https://events.example.test/x")).toBe(
      "events.example.test",
    );
  });
});

describe("parseReach", () => {
  const choices: AudienceChoices = {
    activeSeasonId: FALL,
    seasons: [
      {
        id: FALL,
        name: "Fall 2026",
        teams: [
          { id: KICKERS, name: "Sun Kickers" },
          { id: FOULS, name: "Foul Play" },
        ],
      },
      { id: SUMMER, name: "Summer 2026", teams: [{ id: FOULS, name: "Foul" }] },
    ],
    teams: [
      { id: KICKERS, name: "Sun Kickers" },
      { id: FOULS, name: "Foul Play" },
      { id: DUCKS, name: "Rubber Duckies" },
    ],
  };
  const form: ReachForm = {
    audience: "teams",
    season: FALL,
    teams: [KICKERS, FOULS],
    inviteUrl: "https://partiful.example.test/e/mixer",
    inAppRsvp: "",
  };

  it("reads chosen teams from a season, with the invite instead of in-app RSVPs", () => {
    expect(parseReach(form, "party", choices)).toEqual({
      ok: true,
      value: {
        audience: { kind: "teams", seasonId: FALL, teamIds: [KICKERS, FOULS] },
        inviteUrl: "https://partiful.example.test/e/mixer",
        inAppRsvp: false,
      },
    });
  });

  it("reads teams from any season", () => {
    const parsed = parseReach(
      { ...form, season: "all", teams: [DUCKS] },
      "party",
      choices,
    );
    expect(parsed.ok && parsed.value.audience).toEqual({
      kind: "teams",
      seasonId: null,
      teamIds: [DUCKS],
    });
  });

  it("refuses no teams, a team from another season, and an unknown season", () => {
    expect(parseReach({ ...form, teams: [] }, "party", choices)).toEqual({
      ok: false,
      error: "teams",
    });
    expect(
      parseReach({ ...form, teams: [KICKERS, DUCKS] }, "party", choices),
    ).toEqual({ ok: false, error: "teams" });
    expect(
      parseReach({ ...form, season: "not-a-season" }, "party", choices),
    ).toEqual({ ok: false, error: "season" });
  });

  it("reads everyone and all members, ignoring the team picks", () => {
    for (const audience of ["public", "members"] as const) {
      const parsed = parseReach(
        { ...form, audience, inAppRsvp: "yes" },
        "social",
        choices,
      );
      expect(parsed.ok && parsed.value).toEqual({
        audience: { kind: audience },
        inviteUrl: "https://partiful.example.test/e/mixer",
        inAppRsvp: true,
      });
    }
    expect(
      parseReach({ ...form, audience: "friends" }, "social", choices),
    ).toEqual({ ok: false, error: "audience" });
  });

  it("keeps a theme week public, since it marks the public schedule", () => {
    expect(parseReach(form, "theme_week", choices)).toEqual({
      ok: true,
      value: {
        audience: { kind: "public" },
        inviteUrl: "https://partiful.example.test/e/mixer",
        inAppRsvp: true,
      },
    });
  });

  it("refuses a bad invite link for any audience", () => {
    expect(
      parseReach(
        { ...form, inviteUrl: "http://x.example.test" },
        "party",
        choices,
      ),
    ).toEqual({ ok: false, error: "invite" });
  });

  it("round-trips a stored reach through the form", () => {
    const parsed = parseReach(form, "party", choices);
    if (!parsed.ok) throw new Error("expected a reach");
    expect(
      parseReach(reachFormValues(parsed.value, choices), "party", choices),
    ).toEqual(parsed);
    expect(blankReach(choices)).toEqual({
      audience: "public",
      season: FALL,
      teams: [],
      inviteUrl: "",
      inAppRsvp: "yes",
    });
  });
});

describe("activeSeasonOf", () => {
  const s = (id: string, status: string, startsOn: string) => ({
    id: id as SeasonId,
    status,
    startsOn,
  });
  it("prefers the season being played, then one signing up, then the latest", () => {
    const seasons = [
      s("past", "completed", "2026-06-01"),
      s("now", "in_progress", "2026-09-01"),
      s("next", "registration_open", "2027-03-01"),
      s("draft", "draft", "2027-09-01"),
    ];
    expect(activeSeasonOf(seasons)).toBe("now");
    expect(activeSeasonOf(seasons.filter((x) => x.id !== "now"))).toBe("next");
    expect(activeSeasonOf([seasons[0]!, seasons[3]!])).toBe("past");
    expect(activeSeasonOf([seasons[3]!])).toBeNull();
  });
});
