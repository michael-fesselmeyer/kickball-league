import { describe, expect, it } from "vitest";
import {
  canSeeResults,
  checkVote,
  optionResults,
  type PollForm,
  parsePollForm,
  teamList,
} from "./captain-polls";

const NOW = new Date("2026-09-15T16:00:00Z");
const ctx = { now: NOW, timeZone: "America/New_York" };
const form = (over: Partial<PollForm> = {}): PollForm => ({
  title: "Playoff innings?",
  detail: "",
  options: ["Five", "Seven", "", "", ""],
  voters: "captains",
  results: "after_voting",
  closesOn: "2026-09-18",
  closesTime: "21:00",
  ...over,
});

describe("parsePollForm", () => {
  it("skips blank options and closes at the league's wall clock", () => {
    const parsed = parsePollForm(form(), ctx);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        title: "Playoff innings?",
        options: ["Five", "Seven"],
        includeCoCaptains: false,
        results: "after_voting",
        opensAt: NOW,
        closesAt: new Date("2026-09-19T01:00:00Z"),
      },
    });
  });

  it("tidies spaces and keeps the detail's line breaks", () => {
    const parsed = parsePollForm(
      form({ title: "  Makeup   date? ", detail: " Line one\nLine two " }),
      ctx,
    );
    expect(parsed).toMatchObject({
      value: { title: "Makeup date?", detail: "Line one\nLine two" },
    });
  });

  it("takes two to five options", () => {
    expect(parsePollForm(form({ options: ["Only", ""] }), ctx)).toEqual({
      ok: false,
      error: "too_few_options",
    });
    expect(parsePollForm(form({ options: [" ", "A"] }), ctx)).toEqual({
      ok: false,
      error: "too_few_options",
    });
    expect(
      parsePollForm(form({ options: ["A", "B", "C", "D", "E"] }), ctx).ok,
    ).toBe(true);
    expect(
      parsePollForm(form({ options: ["A", "B", "C", "D", "E", "F"] }), ctx),
    ).toEqual({ ok: false, error: "too_many_options" });
  });

  it("refuses the same option twice, ignoring case and spacing", () => {
    expect(parsePollForm(form({ options: ["Five", " five "] }), ctx)).toEqual({
      ok: false,
      error: "duplicate_option",
    });
  });

  it("refuses a long option, a missing or long question and a long note", () => {
    expect(
      parsePollForm(form({ options: ["x".repeat(81), "B"] }), ctx),
    ).toEqual({ ok: false, error: "option_too_long" });
    expect(parsePollForm(form({ title: "  " }), ctx)).toEqual({
      ok: false,
      error: "need_title",
    });
    expect(parsePollForm(form({ title: "x".repeat(121) }), ctx)).toEqual({
      ok: false,
      error: "title_too_long",
    });
    expect(parsePollForm(form({ detail: "x".repeat(601) }), ctx)).toEqual({
      ok: false,
      error: "detail_too_long",
    });
  });

  it("refuses a closing time that has passed, or is now, or is not a time", () => {
    expect(
      parsePollForm(form({ closesOn: "2026-09-15", closesTime: "12:00" }), ctx),
    ).toEqual({ ok: false, error: "close_in_past" });
    expect(
      parsePollForm(form({ closesOn: "2026-09-15", closesTime: "12:01" }), ctx)
        .ok,
    ).toBe(true);
    expect(parsePollForm(form({ closesOn: "soon" }), ctx)).toEqual({
      ok: false,
      error: "bad_close",
    });
  });

  it("reads who votes and when results show, and refuses anything else", () => {
    expect(
      parsePollForm(
        form({ voters: "captains_and_co", results: "at_close" }),
        ctx,
      ),
    ).toMatchObject({
      value: { includeCoCaptains: true, results: "at_close" },
    });
    expect(parsePollForm(form({ voters: "everyone" }), ctx)).toEqual({
      ok: false,
      error: "bad_voters",
    });
    expect(parsePollForm(form({ results: "never" }), ctx)).toEqual({
      ok: false,
      error: "bad_results",
    });
  });
});

describe("checkVote", () => {
  const poll = {
    opensAt: new Date("2026-09-15T00:00:00Z"),
    closesAt: new Date("2026-09-16T00:00:00Z"),
    includeCoCaptains: false,
  };
  const base = {
    poll,
    now: NOW,
    role: "captain" as "captain" | "co_captain" | null,
    teamInPoll: true,
    optionId: "a",
    optionIds: ["a", "b"],
  };

  it("lets a captain vote for their team while it is open", () => {
    expect(checkVote(base).ok).toBe(true);
  });

  it("closes at the closing time exactly, and not before opening", () => {
    expect(checkVote({ ...base, now: poll.closesAt })).toEqual({
      ok: false,
      error: "not_open",
    });
    expect(
      checkVote({ ...base, now: new Date(poll.opensAt.getTime() - 1) }),
    ).toEqual({
      ok: false,
      error: "not_open",
    });
  });

  it("lets a co-captain vote only when the poll includes them", () => {
    expect(checkVote({ ...base, role: "co_captain" })).toEqual({
      ok: false,
      error: "not_a_voter",
    });
    expect(
      checkVote({
        ...base,
        role: "co_captain",
        poll: { ...poll, includeCoCaptains: true },
      }).ok,
    ).toBe(true);
  });

  it("refuses a player, a team outside the poll and a stray option", () => {
    expect(checkVote({ ...base, role: null })).toEqual({
      ok: false,
      error: "not_a_voter",
    });
    expect(checkVote({ ...base, teamInPoll: false })).toEqual({
      ok: false,
      error: "team_not_in_poll",
    });
    expect(checkVote({ ...base, optionId: "z" })).toEqual({
      ok: false,
      error: "not_an_option",
    });
  });
});

describe("canSeeResults", () => {
  const seen = (
    viewer: "admin" | "captain",
    state: "upcoming" | "open" | "closed",
    visibility: "after_voting" | "at_close",
    teamVoted: boolean,
  ) => canSeeResults({ viewer, state, visibility, teamVoted });

  it("always shows admins, as votes come in", () => {
    expect(seen("admin", "open", "at_close", false)).toBe(true);
    expect(seen("admin", "upcoming", "at_close", false)).toBe(true);
  });

  it("shows a captain once their team has voted, when set to after voting", () => {
    expect(seen("captain", "open", "after_voting", false)).toBe(false);
    expect(seen("captain", "open", "after_voting", true)).toBe(true);
  });

  it("holds results for captains until close when set to at close", () => {
    expect(seen("captain", "open", "at_close", true)).toBe(false);
    expect(seen("captain", "closed", "at_close", false)).toBe(true);
  });
});

describe("optionResults", () => {
  const options = [
    { id: "a", label: "Five", position: 1 },
    { id: "b", label: "Seven", position: 2 },
    { id: "c", label: "Nine", position: 3 },
  ];

  it("keeps the admin's order, ranks, and lists an unpicked option", () => {
    const r = optionResults(
      options,
      new Map([
        ["b", 3],
        ["a", 1],
      ]),
    );
    expect(r.rows.map((x) => [x.label, x.votes, x.rank, x.percent])).toEqual([
      ["Five", 1, 2, 25],
      ["Seven", 3, 1, 75],
      ["Nine", 0, 3, 0],
    ]);
    expect(r.winners).toEqual(["b"]);
    expect(r.total).toBe(4);
  });

  it("shares a rank in a tie, and skips the next", () => {
    const r = optionResults(
      options,
      new Map([
        ["a", 2],
        ["b", 2],
        ["c", 1],
      ]),
    );
    expect(r.rows.map((x) => x.rank)).toEqual([1, 1, 3]);
    expect(r.winners).toEqual(["a", "b"]);
  });

  it("has no winner before anyone votes", () => {
    const r = optionResults(options, new Map());
    expect(r.winners).toEqual([]);
    expect(r.rows.map((x) => x.rank)).toEqual([1, 1, 1]);
    expect(r.total).toBe(0);
  });
});

describe("teamList", () => {
  it("joins names the way a sentence does", () => {
    expect(teamList([])).toBe("");
    expect(teamList(["Aces"])).toBe("Aces");
    expect(teamList(["Aces", "Bees"])).toBe("Aces and Bees");
    expect(teamList(["Aces", "Bees", "Cats"])).toBe("Aces, Bees and Cats");
  });
});
