import { describe, expect, it } from "vitest";
import {
  ANSWER_GRACE_DAYS,
  ballotFor,
  canAnswer,
  canOpenFor,
  type Candidate,
  checkChoice,
  checkOpen,
  DAY_MS,
  defaultChoice,
  quorumMet,
  quorumNeeded,
  resultOf,
  resumedDeadline,
  standing,
  stillAnswering,
  tally,
} from "./leadership";

const cand = (over: Partial<Candidate>): Candidate => ({
  userId: "x",
  role: "captain",
  volunteered: false,
  nominated: false,
  answer: null,
  ...over,
});

describe("season boundaries", () => {
  it("opens only once the regular season is over", () => {
    expect(canOpenFor("playoffs")).toBe(true);
    expect(canOpenFor("completed")).toBe(true);
    for (const s of [
      "draft",
      "registration_open",
      "registration_closed",
      "in_progress",
    ] as const)
      expect(canOpenFor(s)).toBe(false);
  });
});

describe("quorum", () => {
  it("needs the league's share of the roster, rounded up", () => {
    expect(quorumMet(6, 10, 60)).toBe(true);
    expect(quorumMet(5, 10, 60)).toBe(false);
    expect(quorumNeeded(10, 60)).toBe(6);
    expect(quorumNeeded(11, 60)).toBe(7);
    expect(quorumMet(7, 11, 60)).toBe(true);
    expect(quorumMet(6, 11, 60)).toBe(false);
  });

  it("is never met on an empty roster", () => {
    expect(quorumMet(0, 0, 50)).toBe(false);
    expect(quorumNeeded(0, 50)).toBe(1);
  });
});

describe("who is standing", () => {
  it("counts volunteers and suggested teammates who said yes", () => {
    expect(standing(cand({ volunteered: true }))).toBe(true);
    expect(standing(cand({ nominated: true }))).toBe(false);
    expect(standing(cand({ nominated: true, answer: "accepted" }))).toBe(true);
  });

  it("drops anyone who declined, volunteers who withdrew included", () => {
    expect(standing(cand({ nominated: true, answer: "declined" }))).toBe(false);
    expect(standing(cand({ volunteered: true, answer: "declined" }))).toBe(
      false,
    );
  });

  it("waits for a suggested teammate for a fair while, then stops waiting", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const asked = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const n = cand({ nominated: true });
    expect(stillAnswering({ ...n, askedAt: null }, now)).toBe(true);
    expect(stillAnswering({ ...n, askedAt: asked(1) }, now)).toBe(true);
    expect(
      stillAnswering({ ...n, askedAt: asked(ANSWER_GRACE_DAYS) }, now),
    ).toBe(false);
    expect(
      stillAnswering({ ...n, answer: "declined", askedAt: asked(0) }, now),
    ).toBe(false);
    expect(
      stillAnswering(
        { ...cand({ volunteered: true, nominated: true }), askedAt: null },
        now,
      ),
    ).toBe(false);
  });
});

describe("the ballot", () => {
  const roster = new Set(["cap", "a", "b"]);

  it("puts the captain first, then teammates standing for captain", () => {
    expect(
      ballotFor({
        captainId: "cap",
        captainSteppingDown: false,
        onRoster: roster,
        candidates: [
          cand({ userId: "a", volunteered: true }),
          cand({ userId: "b", nominated: true, answer: "accepted" }),
          cand({ userId: "b", role: "co_captain", volunteered: true }),
        ],
      }),
    ).toEqual(["cap", "a", "b"]);
  });

  it("has nothing to vote on when nobody but the captain stands", () => {
    expect(
      ballotFor({
        captainId: "cap",
        captainSteppingDown: false,
        onRoster: roster,
        candidates: [
          cand({ userId: "cap", volunteered: true }),
          cand({ userId: "a", role: "co_captain", volunteered: true }),
        ],
      }),
    ).toBeNull();
  });

  it("leaves out a nominee who declined and anyone who left the team", () => {
    expect(
      ballotFor({
        captainId: "cap",
        captainSteppingDown: false,
        onRoster: roster,
        candidates: [
          cand({ userId: "a", nominated: true, answer: "declined" }),
          cand({ userId: "gone", volunteered: true }),
        ],
      }),
    ).toBeNull();
  });

  it("leaves the captain off when they said they'd hand over", () => {
    expect(
      ballotFor({
        captainId: "cap",
        captainSteppingDown: true,
        onRoster: roster,
        candidates: [cand({ userId: "a", volunteered: true })],
      }),
    ).toEqual(["a"]);
  });
});

describe("the tally", () => {
  it("needs more than half the ballots", () => {
    expect(
      tally([
        { userId: "cap", votes: 4 },
        { userId: "a", votes: 5 },
      ]),
    ).toEqual({ kind: "winner", userId: "a" });
    expect(
      tally([
        { userId: "cap", votes: 3 },
        { userId: "a", votes: 4 },
        { userId: "b", votes: 2 },
      ]),
    ).toEqual({ kind: "no_majority" });
  });

  it("treats a tie as no majority", () => {
    expect(
      tally([
        { userId: "cap", votes: 4 },
        { userId: "a", votes: 4 },
      ]),
    ).toEqual({ kind: "no_majority" });
  });

  it("treats an empty ballot box as no majority", () => {
    expect(tally([{ userId: "a", votes: 0 }])).toEqual({
      kind: "no_majority",
    });
  });

  it("keeps the captain when they win, and changes nothing if the winner left", () => {
    const onRoster = new Set(["cap", "a"]);
    expect(
      resultOf({
        tally: { kind: "winner", userId: "cap" },
        captainId: "cap",
        onRoster,
      }),
    ).toEqual({ outcome: "captain_stays" });
    expect(
      resultOf({
        tally: { kind: "winner", userId: "gone" },
        captainId: "cap",
        onRoster,
      }),
    ).toEqual({ outcome: "winner_left" });
    expect(
      resultOf({
        tally: { kind: "winner", userId: "a" },
        captainId: "cap",
        onRoster,
      }),
    ).toEqual({ outcome: "new_captain", electedId: "a" });
  });

  it("hands over by default only when the captain said they would", () => {
    expect(defaultChoice(true)).toBe("hand_off_now");
    expect(defaultChoice(false)).toBe("captain_elect");
  });
});

describe("a check-in", () => {
  const roster = new Map([
    ["cap", "captain"],
    ["co", "co_captain"],
    ["p", "player"],
  ] as const);
  const none = { volunteer: [], suggest: null, steppingDown: false };

  it("can say things are good as they are", () => {
    expect(checkChoice("p", roster, none).ok).toBe(true);
  });

  it("refuses someone who isn't on the team", () => {
    expect(checkChoice("x", roster, none)).toEqual({
      ok: false,
      error: "not_on_team",
    });
  });

  it("suggests a teammate, never yourself or someone off the team", () => {
    expect(
      checkChoice("p", roster, {
        ...none,
        suggest: { userId: "co", role: "captain" },
      }).ok,
    ).toBe(true);
    expect(
      checkChoice("p", roster, {
        ...none,
        suggest: { userId: "p", role: "captain" },
      }),
    ).toEqual({ ok: false, error: "suggest_self" });
    expect(
      checkChoice("p", roster, {
        ...none,
        suggest: { userId: "x", role: "co_captain" },
      }),
    ).toEqual({ ok: false, error: "suggest_not_on_team" });
  });

  it("doesn't put someone forward for a role they already hold", () => {
    expect(
      checkChoice("p", roster, {
        ...none,
        suggest: { userId: "cap", role: "captain" },
      }),
    ).toEqual({ ok: false, error: "already_in_role" });
    expect(
      checkChoice("p", roster, {
        ...none,
        suggest: { userId: "co", role: "co_captain" },
      }),
    ).toEqual({ ok: false, error: "already_in_role" });
    expect(
      checkChoice("co", roster, { ...none, volunteer: ["co_captain"] }),
    ).toEqual({ ok: false, error: "already_in_role" });
    expect(
      checkChoice("co", roster, { ...none, volunteer: ["captain"] }).ok,
    ).toBe(true);
  });

  it("lets only the captain say they'd hand over", () => {
    expect(checkChoice("cap", roster, { ...none, steppingDown: true }).ok).toBe(
      true,
    );
    expect(checkChoice("p", roster, { ...none, steppingDown: true })).toEqual({
      ok: false,
      error: "not_captain",
    });
  });
});

describe("open, paused and closed", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const later = new Date("2026-11-12T12:00:00Z");
  const base = {
    step: "check_in" as const,
    pausedAt: null,
    checkInClosesAt: later,
    ballotClosesAt: null,
  };

  it("takes a check-in until it closes, and nothing while paused", () => {
    expect(checkOpen(base, "check_in", now).ok).toBe(true);
    expect(checkOpen(base, "check_in", later)).toEqual({
      ok: false,
      error: "closed",
    });
    expect(checkOpen({ ...base, pausedAt: now }, "check_in", now)).toEqual({
      ok: false,
      error: "paused",
    });
    expect(checkOpen(base, "ballot", now)).toEqual({
      ok: false,
      error: "closed",
    });
    expect(canAnswer(base)).toBe(true);
    expect(canAnswer({ ...base, pausedAt: now })).toBe(false);
    expect(canAnswer({ ...base, step: "ballot" })).toBe(false);
  });

  it("moves the deadline on by the time it was paused", () => {
    const pausedAt = new Date("2026-11-09T12:00:00Z");
    expect(resumedDeadline(later, pausedAt, now)).toEqual(
      new Date("2026-11-13T12:00:00Z"),
    );
  });
});
