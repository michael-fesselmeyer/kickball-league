import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  can,
  type Action,
  type Context,
  type Subject,
  VISITOR,
} from "./permissions";

const person = (userId: string, extra: Partial<Subject> = {}): Subject => ({
  ...VISITOR,
  userId,
  globalRole: "player",
  ...extra,
});

const people = {
  visitor: VISITOR,
  player: person("p", { roster: [{ teamSeasonId: "A", role: "player" }] }),
  captain: person("c", { roster: [{ teamSeasonId: "A", role: "captain" }] }),
  coCaptain: person("cc", {
    roster: [{ teamSeasonId: "A", role: "co_captain" }],
  }),
  referee: person("r", { isReferee: true, refereeGameIds: ["g1"] }),
  sponsor: person("s", { sponsorIds: ["bar"] }),
  admin: person("a", { globalRole: "admin" }),
  owner: person("o", { globalRole: "owner" }),
};
type Who = keyof typeof people;
const everyone = Object.keys(people) as Who[];

/** Who among `everyone` may do `action` in `context`. */
const allowed = (action: Action, context: Context = {}) =>
  everyone.filter((who) => can(people[who], action, context));

const g1 = { id: "g1", teamSeasonIds: ["A", "B"] as const };
const g2 = { id: "g2", teamSeasonIds: ["C", "D"] as const };

describe("the permissions matrix (product-spec.md, section 5)", () => {
  it("lets everyone view public pages and roster names", () => {
    expect(allowed("public.view")).toEqual(everyone);
    expect(allowed("roster.view_names")).toEqual(everyone);
  });

  it("limits own-record actions to that person", () => {
    for (const action of [
      "profile.edit",
      "waiver.sign",
      "payment.pay_own",
    ] as const) {
      expect(allowed(action, { targetUserId: "p" })).toEqual(["player"]);
      expect(allowed(action, { targetUserId: "nobody" })).toEqual([]);
    }
    // Exporting or deleting personal data: yourself, or the owner.
    expect(allowed("data.export_or_delete", { targetUserId: "p" })).toEqual([
      "player",
      "owner",
    ]);
  });

  it("lets any signed-in person register, request a team, and join events", () => {
    for (const action of [
      "registration.join",
      "team.register",
      "team.request_new",
      "event.rsvp",
      "sponsor.check_in",
    ] as const)
      expect(allowed(action)).toEqual(everyone.filter((w) => w !== "visitor"));
  });

  it("lets eligible signed-in people claim subs, and rostered players vote", () => {
    expect(allowed("sub_request.claim", { eligibleToSub: true })).toEqual(
      everyone.filter((w) => w !== "visitor"),
    );
    expect(allowed("sub_request.claim", { eligibleToSub: false })).toEqual([]);
    expect(allowed("awards.vote")).toEqual(["player", "captain", "coCaptain"]);
  });

  it("handles RSVPs: your own on your team, and the team's list for its members", () => {
    expect(
      allowed("rsvp.set", { targetUserId: "p", teamSeasonId: "A" }),
    ).toEqual(["player"]);
    expect(
      allowed("rsvp.set", { targetUserId: "p", teamSeasonId: "B" }),
    ).toEqual([]);
    expect(allowed("rsvp.view_team", { teamSeasonId: "A" })).toEqual([
      "player",
      "captain",
      "coCaptain",
      "admin",
      "owner",
    ]);
  });

  it("shows payment and waiver status to the member, their captains, and admins", () => {
    expect(
      allowed("roster.view_status", { teamSeasonId: "A", targetUserId: "p" }),
    ).toEqual(["player", "captain", "coCaptain", "admin", "owner"]);
    expect(
      allowed("roster.view_status", { teamSeasonId: "B", targetUserId: "x" }),
    ).toEqual(["admin", "owner"]);
  });

  it("shows contact details to captains, opted-in teammates, admins, and referees for captains", () => {
    expect(allowed("roster.view_contacts", { teamSeasonId: "A" })).toEqual([
      "captain",
      "coCaptain",
      "admin",
      "owner",
    ]);
    expect(
      allowed("roster.view_contacts", {
        teamSeasonId: "A",
        memberOptedIn: true,
      }),
    ).toEqual(["player", "captain", "coCaptain", "admin", "owner"]);
    // A referee sees the captains of the games they referee, nobody else.
    const captainOfB = { teamSeasonId: "B", targetRole: "captain" as const };
    expect(
      allowed("roster.view_contacts", { ...captainOfB, game: g1 }),
    ).toContain("referee");
    expect(
      allowed("roster.view_contacts", { ...captainOfB, game: g2 }),
    ).not.toContain("referee");
    expect(
      allowed("roster.view_contacts", {
        teamSeasonId: "B",
        targetRole: "player",
        game: g1,
      }),
    ).not.toContain("referee");
    expect(
      allowed("roster.view_contacts", { targetRole: "captain", game: g1 }),
    ).not.toContain("referee");
    expect(allowed("opposing_captain.view_contact", { game: g1 })).toEqual([
      "captain",
      "coCaptain",
      "referee",
      "admin",
      "owner",
    ]);
  });

  it("lets captains run their own team, but not a co-captain remove the captain", () => {
    expect(
      allowed("roster.manage", { teamSeasonId: "A", targetRole: "player" }),
    ).toEqual(["captain", "coCaptain", "admin", "owner"]);
    expect(
      allowed("roster.manage", { teamSeasonId: "A", targetRole: "captain" }),
    ).toEqual(["captain", "admin", "owner"]);
    expect(allowed("roster.manage", { teamSeasonId: "B" })).toEqual([
      "admin",
      "owner",
    ]);
    for (const action of [
      "sub_request.post",
      "sub_request.decide",
      "conflicts.submit",
      "payment.record_offline",
    ] as const)
      expect(allowed(action, { teamSeasonId: "A" })).toEqual([
        "captain",
        "coCaptain",
        "admin",
        "owner",
      ]);
  });

  it("shows a game's pickups to both captains, its ref and admins", () => {
    expect(allowed("sub_request.view_pickups", { game: g1 })).toEqual([
      "captain",
      "coCaptain",
      "referee",
      "admin",
      "owner",
    ]);
    expect(allowed("sub_request.view_pickups", { game: g2 })).toEqual([
      "admin",
      "owner",
    ]);
    expect(allowed("sub_request.decide", { teamSeasonId: "B" })).toEqual([
      "admin",
      "owner",
    ]);
  });

  it("exports a team's roster and payments to its captains, and the season's to admins", () => {
    for (const action of ["roster.export", "payments.export"] as const) {
      expect(allowed(action, { teamSeasonId: "A" })).toEqual([
        "captain",
        "coCaptain",
        "admin",
        "owner",
      ]);
      expect(allowed(action, { teamSeasonId: "B" })).toEqual([
        "admin",
        "owner",
      ]);
      // No team means every team in the season.
      expect(allowed(action)).toEqual(["admin", "owner"]);
    }
  });

  it("lets the right people enter and confirm scores", () => {
    expect(allowed("score.enter", { game: g1 })).toEqual([
      "captain",
      "coCaptain",
      "referee",
      "admin",
      "owner",
    ]);
    expect(allowed("score.enter", { game: g2 })).toEqual(["admin", "owner"]);
    expect(allowed("score.enter")).toEqual(["admin", "owner"]);
    expect(allowed("score.confirm", { game: g1 })).toEqual([
      "captain",
      "coCaptain",
      "admin",
      "owner",
    ]);
  });

  it("lets the ref, or a captain when there is no ref, score inning by inning", () => {
    // g1 has a ref (the referee person is assigned to it).
    expect(
      allowed("score.live", { game: { ...g1, hasReferee: true } }),
    ).toEqual(["referee", "admin", "owner"]);
    expect(
      allowed("score.live", { game: { ...g1, hasReferee: false } }),
    ).toEqual(["captain", "coCaptain", "referee", "admin", "owner"]);
    // Not knowing whether there is a ref is not permission for captains.
    expect(allowed("score.live", { game: g1 })).toEqual([
      "referee",
      "admin",
      "owner",
    ]);
    expect(
      allowed("score.live", { game: { ...g2, hasReferee: false } }),
    ).toEqual(["admin", "owner"]);
  });

  it("sends announcements: captains to their team, admins to anyone", () => {
    expect(
      allowed("announcement.send", { scope: "team", teamSeasonId: "A" }),
    ).toEqual(["captain", "coCaptain", "admin", "owner"]);
    expect(allowed("announcement.send", { scope: "league" })).toEqual([
      "admin",
      "owner",
    ]);
  });

  it("gives referees their own tools and incident logging for their games", () => {
    expect(allowed("referee.availability")).toEqual(["referee"]);
    expect(allowed("referee.earnings")).toEqual(["referee"]);
    expect(allowed("incident.log", { game: g1 })).toEqual([
      "referee",
      "admin",
      "owner",
    ]);
    expect(allowed("incident.log", { game: g2 })).toEqual(["admin", "owner"]);
  });

  it("lets sponsors manage their own page and report", () => {
    for (const action of ["sponsor.edit", "sponsor.report"] as const) {
      expect(allowed(action, { sponsorId: "bar" })).toEqual([
        "sponsor",
        "admin",
        "owner",
      ]);
      expect(allowed(action, { sponsorId: "other" })).toEqual([
        "admin",
        "owner",
      ]);
      expect(allowed(action)).toEqual(["admin", "owner"]);
    }
  });

  it("keeps league management to admins, and money and admins to the owner", () => {
    for (const action of [
      "score.override",
      "season.manage",
      "schedule.manage",
      "rainout.declare",
      "free_agents.place",
      "team.approve_new",
      "event.manage",
      "referee.manage",
      "player.suspend",
      "refund.issue",
      "audit.read",
      "shirts.manage",
      "awards.manage",
    ] as const)
      expect(allowed(action)).toEqual(["admin", "owner"]);
    for (const action of ["billing.manage", "admins.manage"] as const)
      expect(allowed(action)).toEqual(["owner"]);
  });
});

describe("permission properties", () => {
  const id = fc.constantFrom("A", "B", "C");
  const subject = fc.record({
    userId: fc.option(fc.constantFrom("u1", "u2"), { nil: null }),
    globalRole: fc.constantFrom(
      "player" as const,
      "admin" as const,
      "owner" as const,
    ),
    roster: fc.array(
      fc.record({
        teamSeasonId: id,
        role: fc.constantFrom(
          "captain" as const,
          "co_captain" as const,
          "player" as const,
        ),
      }),
      { maxLength: 2 },
    ),
    isReferee: fc.boolean(),
    refereeGameIds: fc.array(fc.constantFrom("g1", "g2"), { maxLength: 2 }),
    sponsorIds: fc.array(fc.constantFrom("bar", "cafe"), { maxLength: 2 }),
  });
  const context: fc.Arbitrary<Context> = fc.record(
    {
      targetUserId: fc.constantFrom("u1", "u2"),
      teamSeasonId: id,
      targetRole: fc.constantFrom(
        "captain" as const,
        "co_captain" as const,
        "player" as const,
      ),
      game: fc.constantFrom(g1, g2),
      sponsorId: fc.constantFrom("bar", "cafe"),
      memberOptedIn: fc.boolean(),
      eligibleToSub: fc.boolean(),
      scope: fc.constantFrom("team" as const, "league" as const),
    },
    { requiredKeys: [] },
  );

  it("an admin or owner can do everything a player can, except act as another person", () => {
    fc.assert(
      fc.property(
        subject,
        context,
        fc.constantFrom(...ACTIONS),
        (s, c, action) => {
          const upgraded = { ...s, globalRole: "owner" as const };
          if (s.userId !== null && can(s, action, c))
            expect(can(upgraded, action, c)).toBe(true);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("an extra referee assignment or sponsor never takes a right away", () => {
    fc.assert(
      fc.property(
        subject,
        context,
        fc.constantFrom(...ACTIONS),
        (s, c, action) => {
          const more = {
            ...s,
            refereeGameIds: [...s.refereeGameIds, "g1", "g2"],
            sponsorIds: [...s.sponsorIds, "bar", "cafe"],
            isReferee: true,
          };
          if (can(s, action, c)) expect(can(more, action, c)).toBe(true);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("a visitor can only view public pages and roster names", () => {
    fc.assert(
      fc.property(context, fc.constantFrom(...ACTIONS), (c, action) => {
        if (can(VISITOR, action, c))
          expect(["public.view", "roster.view_names"]).toContain(action);
      }),
      { numRuns: 2000 },
    );
  });
});
