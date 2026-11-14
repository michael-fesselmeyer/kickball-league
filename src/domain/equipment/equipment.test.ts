import { describe, expect, it } from "vitest";
import {
  assignedNow,
  bringBy,
  checkAnswer,
  checkCancel,
  checkHandOff,
  checkPickUp,
  checkReturnHome,
  dayWords,
  type KitState,
  kitLine,
  mayReport,
  nextReceiver,
  parseKitForm,
  parseMissingForm,
  remindsTonight,
  whereabouts,
} from "./equipment";

const TZ = "America/New_York";
// Tuesday, November 17, 2026, 7:00 PM in New York.
const KICKOFF = new Date("2026-11-18T00:00:00Z");
const MONDAY_EVENING = new Date("2026-11-16T23:00:00Z");
const TUESDAY_NOON = new Date("2026-11-17T17:00:00Z");

const held = (holderId: string | null): KitState => ({
  holderId,
  retired: false,
  pending: null,
});

describe("parseKitForm", () => {
  it("reads one item per line, dropping blanks and repeats", () => {
    expect(
      parseKitForm({
        name: "  Kit   A ",
        contents: "Ball bag (4 balls)\n\n  Bases (4)\r\nbases (4)\nPump\n",
        homeLocation: "Storage locker",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Kit A",
        contents: ["Ball bag (4 balls)", "Bases (4)", "Pump"],
        homeLocation: "Storage locker",
      },
    });
  });

  it("needs a name, at least one item and a home", () => {
    const base = { name: "Kit A", contents: "Pump", homeLocation: "Locker" };
    expect(parseKitForm({ ...base, name: " " })).toEqual({
      ok: false,
      error: "name_missing",
    });
    expect(parseKitForm({ ...base, contents: "\n \n" })).toEqual({
      ok: false,
      error: "contents_missing",
    });
    expect(parseKitForm({ ...base, homeLocation: undefined })).toEqual({
      ok: false,
      error: "home_missing",
    });
  });

  it("caps the lengths and the number of items", () => {
    const base = { name: "Kit A", contents: "Pump", homeLocation: "Locker" };
    expect(parseKitForm({ ...base, name: "x".repeat(41) }).ok).toBe(false);
    expect(parseKitForm({ ...base, contents: "x".repeat(61) }).ok).toBe(false);
    expect(
      parseKitForm({
        ...base,
        contents: Array.from({ length: 21 }, (_, i) => `Item ${i}`).join("\n"),
      }),
    ).toEqual({ ok: false, error: "too_many_items" });
  });
});

describe("parseMissingForm", () => {
  const contents = ["Ball bag", "Bases (4)", "Pump"];

  it("keeps the kit's order and drops repeats", () => {
    expect(
      parseMissingForm(contents, ["Pump", "Ball bag", "Pump"], " needle "),
    ).toEqual({
      ok: true,
      value: { missing: ["Ball bag", "Pump"], note: "needle" },
    });
  });

  it("refuses items the kit doesn't have, and an empty report", () => {
    expect(parseMissingForm(contents, ["Bat"], "").ok).toBe(false);
    expect(parseMissingForm(contents, [], "  ")).toEqual({
      ok: false,
      error: "nothing",
    });
  });

  it("takes a note on its own", () => {
    expect(parseMissingForm(contents, [], "Bag is torn")).toEqual({
      ok: true,
      value: { missing: [], note: "Bag is torn" },
    });
  });
});

describe("handoffs", () => {
  it("lets only the holder hand on, to someone else, one at a time", () => {
    expect(checkHandOff(held("jo"), "jo", "sam")).toEqual({
      ok: true,
      value: "sam",
    });
    expect(checkHandOff(held("jo"), "sam", "pat").ok).toBe(false);
    expect(checkHandOff(held("jo"), "jo", "jo")).toEqual({
      ok: false,
      error: "self",
    });
    expect(checkHandOff(held("jo"), "jo", null)).toEqual({
      ok: false,
      error: "no_receiver",
    });
    expect(
      checkHandOff(
        { ...held("jo"), pending: { fromUserId: "jo", toUserId: "sam" } },
        "jo",
        "sam",
      ),
    ).toEqual({ ok: false, error: "pending" });
    expect(checkHandOff({ ...held("jo"), retired: true }, "jo", "sam")).toEqual(
      { ok: false, error: "retired" },
    );
  });

  it("lets only the receiver answer, and only the giver take it back", () => {
    const pending = { status: "pending", fromUserId: "jo", toUserId: "sam" };
    expect(checkAnswer(pending, "sam").ok).toBe(true);
    expect(checkAnswer(pending, "jo")).toEqual({
      ok: false,
      error: "not_receiver",
    });
    expect(checkAnswer({ ...pending, status: "confirmed" }, "sam")).toEqual({
      ok: false,
      error: "not_pending",
    });
    expect(checkCancel(pending, "jo").ok).toBe(true);
    expect(checkCancel(pending, "sam")).toEqual({
      ok: false,
      error: "not_giver",
    });
  });

  it("lets someone bringing the kit pick it up from home", () => {
    expect(checkPickUp(held(null), true).ok).toBe(true);
    expect(checkPickUp(held(null), false)).toEqual({
      ok: false,
      error: "not_assigned",
    });
    expect(checkPickUp(held("jo"), true)).toEqual({
      ok: false,
      error: "not_home",
    });
  });

  it("lets the holder return it home", () => {
    expect(checkReturnHome(held("jo"), "jo").ok).toBe(true);
    expect(checkReturnHome(held("jo"), "sam").ok).toBe(false);
  });

  it("lets the holder, the receiver, whoever brings it and admins report", () => {
    const kit = {
      ...held("jo"),
      pending: { fromUserId: "jo", toUserId: "sam" },
    };
    const nobody = { assigned: false, admin: false };
    expect(mayReport(kit, "jo", nobody)).toBe(true);
    expect(mayReport(kit, "sam", nobody)).toBe(true);
    expect(mayReport(kit, "pat", nobody)).toBe(false);
    expect(mayReport(kit, "pat", { assigned: true, admin: false })).toBe(true);
    expect(mayReport(kit, "pat", { assigned: false, admin: true })).toBe(true);
  });
});

describe("who gets the kit next", () => {
  const game = (userId: string, startsAt: string) => ({
    userId,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
  });
  const games = [
    game("sam", "2026-11-24T00:00:00Z"),
    game("jo", "2026-11-18T00:00:00Z"),
    game("pat", "2026-11-20T00:00:00Z"),
  ];

  it("is whoever brings it to its next game, skipping the holder's own", () => {
    expect(nextReceiver(games, "jo", MONDAY_EVENING)?.userId).toBe("pat");
    expect(nextReceiver(games, "pat", MONDAY_EVENING)?.userId).toBe("jo");
  });

  it("skips games that are over, and is nobody when none are left", () => {
    expect(
      nextReceiver(games, "jo", new Date("2026-11-21T00:00:00Z"))?.userId,
    ).toBe("sam");
    expect(nextReceiver(games, "jo", new Date("2026-12-01T00:00:00Z"))).toBe(
      null,
    );
  });

  it("knows who is bringing it to a game still to come", () => {
    expect(assignedNow(games, "pat", MONDAY_EVENING)).toBe(true);
    expect(assignedNow(games, "pat", new Date("2026-12-01T00:00:00Z"))).toBe(
      false,
    );
  });
});

describe("the kit's line", () => {
  it("is due half an hour before kickoff", () => {
    expect(bringBy(KICKOFF).toISOString()).toBe("2026-11-17T23:30:00.000Z");
  });

  it("reads as the holder's job for the day", () => {
    expect(
      kitLine({
        kitName: "Kit A",
        place: "McCarren Park, Field 2",
        startsAt: KICKOFF,
        timeZone: TZ,
        now: TUESDAY_NOON,
        status: { kind: "holding" },
      }),
    ).toBe("You have Kit A: bring it to McCarren Park, Field 2 by 6:30 PM");
  });

  it("says where to get it first, and which day", () => {
    expect(
      kitLine({
        kitName: "Kit A",
        place: "McCarren Park, Field 2",
        startsAt: KICKOFF,
        timeZone: TZ,
        now: MONDAY_EVENING,
        status: { kind: "with", name: "Jo S." },
      }),
    ).toBe(
      "Kit A is yours tomorrow: get it from Jo S., then bring it to McCarren Park, Field 2 by 6:30 PM",
    );
    expect(
      kitLine({
        kitName: "Kit A",
        place: "McCarren Park, Field 2",
        startsAt: KICKOFF,
        timeZone: TZ,
        now: new Date("2026-11-14T15:00:00Z"),
        status: { kind: "at_home", homeLocation: "the locker" },
      }),
    ).toBe(
      "Kit A is yours on Tue, Nov 17: pick it up from the locker, then bring it to McCarren Park, Field 2 by 6:30 PM",
    );
  });

  it("names the day in the league's time zone", () => {
    expect(dayWords(KICKOFF, TUESDAY_NOON, TZ)).toBe("today");
    expect(dayWords(KICKOFF, MONDAY_EVENING, TZ)).toBe("tomorrow");
  });
});

describe("the evening reminder", () => {
  it("goes out the day before the game, in league time", () => {
    expect(remindsTonight(KICKOFF, MONDAY_EVENING, TZ)).toBe(true);
    expect(remindsTonight(KICKOFF, TUESDAY_NOON, TZ)).toBe(false);
    // Sunday evening is two days ahead.
    expect(remindsTonight(KICKOFF, new Date("2026-11-15T23:00:00Z"), TZ)).toBe(
      false,
    );
  });

  it("counts a 7 PM kickoff as Tuesday although it is Wednesday in UTC", () => {
    // 2026-11-18T00:00Z is Wednesday in UTC but Tuesday in New York.
    expect(remindsTonight(KICKOFF, new Date("2026-11-17T02:00:00Z"), TZ)).toBe(
      true,
    );
  });
});

describe("whereabouts", () => {
  const base = {
    holderId: null,
    holderName: null,
    homeLocation: "the locker",
    pendingToName: null,
  };
  it("says who has it, who it's going to, or that it's home", () => {
    expect(whereabouts(base)).toBe("At home: the locker");
    expect(whereabouts({ ...base, holderId: "jo", holderName: "Jo S." })).toBe(
      "With Jo S.",
    );
    expect(
      whereabouts({
        ...base,
        holderId: "jo",
        holderName: "Jo S.",
        pendingToName: "Sam R.",
      }),
    ).toBe("Jo S. is handing it to Sam R.");
  });
});
