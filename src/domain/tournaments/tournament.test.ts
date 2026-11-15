import { describe, expect, it } from "vitest";
import {
  guestDataDeleteAt,
  guestDataDue,
  LINK_TOKEN,
  moneyLine,
  newLinkToken,
  parseGuestSignature,
  parseGuestSignup,
  parseSettings,
  signupState,
} from "./tournament";

const signup = {
  teamName: "  Harbor   Hoppers ",
  captainName: "Sam Rivera",
  captainEmail: "Sam@Example.test",
  rosterSize: "12",
};

describe("parseGuestSignup", () => {
  it("cleans a good sign-up", () => {
    expect(parseGuestSignup(signup)).toEqual({
      ok: true,
      value: {
        teamName: "Harbor Hoppers",
        captainName: "Sam Rivera",
        captainEmail: "sam@example.test",
        rosterSize: 12,
      },
    });
  });
  it.each([
    [{ teamName: "" }, "team_name"],
    [{ teamName: "x".repeat(61) }, "team_name"],
    [{ captainName: " " }, "captain_name"],
    [{ captainEmail: "nope" }, "captain_email"],
    [{ rosterSize: "3" }, "roster_size"],
    [{ rosterSize: "31" }, "roster_size"],
    [{ rosterSize: "12.5" }, "roster_size"],
    [{ rosterSize: "" }, "roster_size"],
  ])("refuses %j", (change, error) => {
    expect(parseGuestSignup({ ...signup, ...change })).toEqual({
      ok: false,
      error,
    });
  });
});

describe("guest waiver and links", () => {
  it("needs a name and the agreement", () => {
    expect(parseGuestSignature({ signedName: "Jo Lee", agree: "on" }).ok).toBe(
      true,
    );
    expect(parseGuestSignature({ signedName: "Jo", agree: "on" })).toEqual({
      ok: false,
      error: "name",
    });
    expect(parseGuestSignature({ signedName: "Jo Lee" })).toEqual({
      ok: false,
      error: "agree",
    });
  });
  it("makes unguessable, URL-safe tokens", () => {
    const a = newLinkToken();
    expect(a).toMatch(LINK_TOKEN);
    expect(newLinkToken()).not.toBe(a);
  });
});

describe("parseSettings", () => {
  it("takes no charity by default", () => {
    expect(parseSettings({ guestSignupsOpen: "on" })).toMatchObject({
      ok: true,
      value: { charity: null, maxGuestTeams: null, guestDataDays: 30 },
    });
  });
  it("takes a charity link and goal in dollars", () => {
    expect(
      parseSettings({
        charityName: "Neighborhood Food Pantry",
        charityUrl: "https://pantry.example.test/give",
        charityGoal: "$2,500",
      }),
    ).toMatchObject({ ok: true, value: { charity: { goalCents: 250000 } } });
  });
  it.each([
    [{ charityUrl: "http://a.example.test", charityName: "x" }, "charity_url"],
    [{ charityUrl: "https://a.example.test" }, "charity_name"],
    [{ charityName: "x" }, "charity_url"],
    [
      {
        charityName: "x",
        charityUrl: "https://a.example.test",
        charityGoal: "0",
      },
      "charity_goal",
    ],
    [{ maxGuestTeams: "0" }, "max_teams"],
    [{ maxGuestTeams: "33" }, "max_teams"],
    [{ guestDataDays: "0" }, "data_days"],
    [{ guestDataDays: "91" }, "data_days"],
  ])("refuses %j", (fields, error) => {
    expect(parseSettings(fields)).toEqual({ ok: false, error });
  });
  it("formats money", () => {
    expect(moneyLine(250000)).toBe("$2,500");
    expect(moneyLine(1250)).toBe("$12.50");
  });
});

describe("sign-up window and deletion date", () => {
  const e = { endsAt: new Date("2027-06-05T22:00:00Z"), cancelledAt: null };
  const t = { guestSignupsOpen: true, maxGuestTeams: 4, guestTeams: 3 };
  const before = new Date("2027-05-01T00:00:00Z");
  it("is open, full, closed, over or cancelled", () => {
    expect(signupState(t, e, before)).toBe("open");
    expect(signupState({ ...t, guestTeams: 4 }, e, before)).toBe("full");
    expect(signupState({ ...t, guestSignupsOpen: false }, e, before)).toBe(
      "closed",
    );
    expect(signupState(t, e, e.endsAt)).toBe("over");
    expect(signupState(t, { ...e, cancelledAt: new Date() }, before)).toBe(
      "cancelled",
    );
  });
  it("deletes guest data a set number of days after the event ends", () => {
    expect(guestDataDeleteAt(e.endsAt, 30).toISOString()).toBe(
      "2027-07-05T22:00:00.000Z",
    );
    const state = { guestDataDeletedAt: null, guestDataDays: 30 };
    expect(guestDataDue(state, e, new Date("2027-07-05T21:59:00Z"))).toBe(
      false,
    );
    expect(guestDataDue(state, e, new Date("2027-07-05T22:00:00Z"))).toBe(true);
    expect(
      guestDataDue(
        { ...state, guestDataDeletedAt: new Date() },
        e,
        new Date("2028-01-01"),
      ),
    ).toBe(false);
  });
});
