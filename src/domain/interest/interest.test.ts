import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYERS_PER_TEAM,
  DEFAULT_TEAMS_NEEDED,
  isBlankOption,
  type OptionCounts,
  optionKey,
  optionLabel,
  parseAnswer,
  parseForm,
  parseNote,
  parseOption,
  readiness,
  teamsFor,
} from "./interest";

const form = (over: Partial<Record<string, string>> = {}) => ({
  title: "Where should we grow?",
  intro: "",
  teamsNeeded: "",
  playersPerTeam: "",
  ...over,
});

describe("parseForm", () => {
  it("takes the defaults for blank numbers", () => {
    expect(parseForm(form())).toEqual({
      ok: true,
      value: {
        title: "Where should we grow?",
        intro: "",
        teamsNeeded: DEFAULT_TEAMS_NEEDED,
        playersPerTeam: DEFAULT_PLAYERS_PER_TEAM,
      },
    });
  });

  it("needs a title and keeps the intro short", () => {
    expect(parseForm(form({ title: "  " }))).toEqual({
      ok: false,
      error: "title",
    });
    expect(parseForm(form({ intro: "x".repeat(601) }))).toEqual({
      ok: false,
      error: "intro",
    });
  });

  it.each(["0", "41", "3.5", "-2", "abc", "1e2"])(
    "refuses %s teams needed",
    (teamsNeeded) => {
      expect(parseForm(form({ teamsNeeded }))).toEqual({
        ok: false,
        error: "teams",
      });
    },
  );

  it("refuses a team size outside 6 to 25", () => {
    expect(parseForm(form({ playersPerTeam: "5" })).ok).toBe(false);
    expect(parseForm(form({ playersPerTeam: "26" })).ok).toBe(false);
    expect(parseForm(form({ playersPerTeam: "10" })).ok).toBe(true);
  });
});

describe("options", () => {
  it("reads a row and spots a blank one", () => {
    expect(isBlankOption({ park: " ", night: "", format: "" })).toBe(true);
    expect(
      parseOption({
        park: "  Prospect   Park ",
        night: "thursday",
        format: "",
      }),
    ).toEqual({
      ok: true,
      value: { park: "Prospect Park", night: "thursday", format: null },
    });
  });

  it("needs at least one part and knows its parts", () => {
    expect(parseOption({ park: "", night: "", format: "" })).toEqual({
      ok: false,
      error: "empty",
    });
    expect(parseOption({ park: "", night: "someday", format: "" })).toEqual({
      ok: false,
      error: "night",
    });
    expect(parseOption({ park: "", night: "", format: "casual" })).toEqual({
      ok: false,
      error: "format",
    });
    expect(
      parseOption({ park: "x".repeat(81), night: "", format: "" }),
    ).toEqual({ ok: false, error: "park" });
  });

  it("describes an option in words, whatever parts it has", () => {
    expect(
      optionLabel({
        park: "Prospect Park",
        night: "thursday",
        format: "social",
      }),
    ).toBe("Thursday nights · Social · Prospect Park");
    expect(
      optionLabel({ park: null, night: null, format: "competitive" }),
    ).toBe("Competitive");
    expect(
      optionLabel({ park: "Fort Greene Park", night: null, format: null }),
    ).toBe("Fort Greene Park");
  });

  it("treats the same parts, in any case, as one option", () => {
    const a = { park: "Prospect Park", night: null, format: null } as const;
    expect(optionKey(a)).toBe(optionKey({ ...a, park: "prospect park" }));
    expect(optionKey(a)).not.toBe(optionKey({ ...a, night: "monday" }));
  });
});

describe("parseAnswer", () => {
  const ids = ["a", "b"];
  const answers = (entries: [string, string][]) => new Map(entries);

  it("reads yes, not sure and no, and lower-cases the address", () => {
    const parsed = parseAnswer(
      {
        email: "  Pat@Example.TEST ",
        friends: "3",
        answers: answers([
          ["a", "yes"],
          ["b", "no"],
        ]),
      },
      ids,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        email: "pat@example.test",
        friends: 3,
        choices: [{ optionId: "a", response: "yes" }],
      },
    });
  });

  it("allows Not sure for friends and for every option", () => {
    const parsed = parseAnswer(
      {
        email: "pat@example.test",
        friends: "unsure",
        answers: answers([
          ["a", "unsure"],
          ["b", "unsure"],
        ]),
      },
      ids,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        email: "pat@example.test",
        friends: null,
        choices: [
          { optionId: "a", response: "unsure" },
          { optionId: "b", response: "unsure" },
        ],
      },
    });
    expect(
      parseAnswer(
        { email: "pat@example.test", friends: "", answers: answers([]) },
        ids,
      ),
    ).toMatchObject({ ok: true, value: { friends: null, choices: [] } });
  });

  it("refuses a bad address, a bad friend count and an unknown option", () => {
    const base = {
      email: "pat@example.test",
      friends: "0",
      answers: answers([]),
    };
    expect(parseAnswer({ ...base, email: "pat" }, ids)).toEqual({
      ok: false,
      error: "email",
    });
    expect(parseAnswer({ ...base, email: "" }, ids)).toEqual({
      ok: false,
      error: "email",
    });
    expect(parseAnswer({ ...base, friends: "11" }, ids)).toEqual({
      ok: false,
      error: "friends",
    });
    expect(parseAnswer({ ...base, friends: "-1" }, ids)).toEqual({
      ok: false,
      error: "friends",
    });
    expect(
      parseAnswer({ ...base, answers: answers([["zzz", "yes"]]) }, ids),
    ).toEqual({ ok: false, error: "choice" });
    expect(
      parseAnswer({ ...base, answers: answers([["a", "definitely"]]) }, ids),
    ).toEqual({ ok: false, error: "choice" });
  });
});

describe("readiness", () => {
  const counts = (over: Partial<OptionCounts>): OptionCounts => ({
    yesAnswers: 0,
    yesPeople: 0,
    unsureAnswers: 0,
    unsurePeople: 0,
    ...over,
  });
  const target = { teamsNeeded: 8, playersPerTeam: 12 };

  it("fills whole teams only", () => {
    expect(teamsFor(11, 12)).toBe(0);
    expect(teamsFor(24, 12)).toBe(2);
    expect(teamsFor(35, 12)).toBe(2);
  });

  it("marks an option enough at the target and not before", () => {
    expect(readiness(counts({ yesPeople: 95 }), target).enough).toBe(false);
    expect(readiness(counts({ yesPeople: 96 }), target)).toMatchObject({
      teams: 8,
      enough: true,
    });
  });

  it("does not count not-sure answers toward the marker, but shows them", () => {
    const r = readiness(counts({ yesPeople: 60, unsurePeople: 40 }), target);
    expect(r).toMatchObject({
      teams: 5,
      teamsWithMaybes: 8,
      enough: false,
      closeWithMaybes: true,
    });
  });

  it("follows an edit to the target after answers came in", () => {
    const c = counts({ yesPeople: 60 });
    expect(readiness(c, { teamsNeeded: 5, playersPerTeam: 12 }).enough).toBe(
      true,
    );
    expect(readiness(c, { teamsNeeded: 6, playersPerTeam: 12 }).enough).toBe(
      false,
    );
    expect(readiness(c, { teamsNeeded: 5, playersPerTeam: 15 }).enough).toBe(
      false,
    );
  });

  it("says nothing is enough when there are no answers", () => {
    expect(readiness(counts({}), target)).toEqual({
      teams: 0,
      teamsWithMaybes: 0,
      enough: false,
      closeWithMaybes: false,
    });
  });
});

describe("parseNote", () => {
  it("allows no note and caps a long one", () => {
    expect(parseNote("  ")).toEqual({ ok: true, value: "" });
    expect(parseNote("x".repeat(501))).toEqual({ ok: false, error: "note" });
  });
});
