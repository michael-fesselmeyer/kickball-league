import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatFriendCode,
  friendsSentence,
  newFriendCode,
  normalizeFriendCode,
} from "./friend-code";
import {
  labelOf,
  matcherView,
  parseQuiz,
  QUESTIONS,
  RATINGS,
  readAnswers,
  selfRating,
  skillScore,
} from "./quiz";

const complete = {
  kicking: "strong",
  fielding: "solid",
  running: "learning",
  vibe: "social",
  availability: "most_weeks",
  notes: "  Lefty   kicker ",
};

/** A row saved by the quiz's first version. */
const legacy = {
  version: 1,
  experience: "some",
  positions: ["outfield", "pitcher"],
  availability: "every_week",
  vibe: "both",
  captain: "yes",
};

describe("parseQuiz", () => {
  it("scores the self-ratings and the vibe", () => {
    expect(parseQuiz(complete)).toEqual({
      ok: true,
      value: {
        answers: {
          version: 2,
          kicking: "strong",
          fielding: "solid",
          running: "learning",
          vibe: "social",
          availability: "most_weeks",
        },
        skillScore: 3,
        vibeScore: 1,
        wouldCaptain: false,
        notes: "Lefty kicker",
      },
    });
  });

  it.each([
    ["kicking", "missing_kicking"],
    ["fielding", "missing_fielding"],
    ["running", "missing_running"],
    ["vibe", "missing_vibe"],
    ["availability", "missing_availability"],
  ])("asks for %s", (field, error) => {
    expect(parseQuiz({ ...complete, [field]: "nope" })).toEqual({
      ok: false,
      error,
    });
  });

  it("caps the note", () => {
    expect(parseQuiz({ ...complete, notes: "x".repeat(201) })).toEqual({
      ok: false,
      error: "notes_too_long",
    });
    expect(parseQuiz({ ...complete, notes: " " })).toMatchObject({
      value: { notes: null },
    });
  });

  it("is five quick taps", () => {
    expect(Object.keys(QUESTIONS)).toEqual([
      "kicking",
      "fielding",
      "running",
      "vibe",
      "availability",
    ]);
    for (const q of Object.values(QUESTIONS))
      expect(q.choices.length).toBeLessThanOrEqual(3);
  });

  it("keeps the skill score on the 1 to 5 scale, rising with each rating", () => {
    const rating = fc.constantFrom(...RATINGS);
    fc.assert(
      fc.property(rating, rating, rating, (kicking, fielding, running) => {
        const score = skillScore({ kicking, fielding, running });
        expect(score).toBeGreaterThanOrEqual(1);
        expect(score).toBeLessThanOrEqual(5);
        expect(
          skillScore({ kicking: "strong", fielding, running }),
        ).toBeGreaterThanOrEqual(score);
      }),
    );
    expect(
      skillScore({
        kicking: "learning",
        fielding: "learning",
        running: "learning",
      }),
    ).toBe(1);
    expect(
      skillScore({ kicking: "strong", fielding: "strong", running: "strong" }),
    ).toBe(5);
  });
});

describe("stored answers", () => {
  it("reads this version's answers back, and refuses junk", () => {
    const parsed = parseQuiz(complete);
    if (!parsed.ok) throw new Error("expected a parse");
    expect(readAnswers(parsed.value.answers)).toEqual(parsed.value.answers);
    expect(readAnswers({ version: 2, kicking: "x" })).toBeNull();
    expect(readAnswers({ experience: "x" })).toBeNull();
    expect(readAnswers(null)).toBeNull();
  });

  it("still reads the first version's, positions in a fixed order", () => {
    expect(readAnswers(legacy)).toEqual({
      ...legacy,
      positions: ["pitcher", "outfield"],
    });
    // Rows from before the version field read the same way.
    expect(readAnswers({ ...legacy, version: undefined })?.version).toBe(1);
  });

  it("gives the matcher positions and captaining only from the first version", () => {
    const parsed = parseQuiz(complete);
    if (!parsed.ok) throw new Error("expected a parse");
    expect(matcherView(parsed.value.answers)).toEqual({
      availability: "most_weeks",
      positions: [],
      captain: null,
    });
    expect(matcherView(readAnswers(legacy))).toEqual({
      availability: "every_week",
      positions: ["pitcher", "outfield"],
      captain: "yes",
    });
    expect(matcherView(null)).toEqual({
      availability: null,
      positions: [],
      captain: null,
    });
  });

  it("labels answers in the players' words", () => {
    expect(labelOf("vibe", "competitive")).toBe("Competitive");
    expect(labelOf("kicking", "strong")).toBe("A strength");
    expect(labelOf("experience", "some")).toBe("A season or two");
    expect(labelOf("vibe", "unknown")).toBe("unknown");
    const parsed = parseQuiz(complete);
    if (!parsed.ok) throw new Error("expected a parse");
    expect(selfRating(parsed.value.answers)).toBe(
      "Kicking: A strength · Fielding: Solid · Running: Still learning",
    );
    const old = readAnswers(legacy);
    if (!old) throw new Error("expected answers");
    expect(selfRating(old)).toBe("A season or two (Pitcher, Outfield)");
  });
});

describe("friend codes", () => {
  it("makes codes from the readable alphabet", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.9999, noNaN: true }), {
          minLength: 6,
          maxLength: 6,
        }),
        (rolls) => {
          let i = 0;
          const code = newFriendCode(() => rolls[i++] ?? 0);
          expect(code).toHaveLength(CODE_LENGTH);
          for (const c of code) expect(CODE_ALPHABET).toContain(c);
          expect(normalizeFriendCode(formatFriendCode(code))).toBe(code);
          expect(normalizeFriendCode(` ${code.toLowerCase()} `)).toBe(code);
        },
      ),
    );
  });

  it("refuses what cannot be a code", () => {
    expect(normalizeFriendCode("ABC")).toBeNull();
    expect(normalizeFriendCode("ABCDE0")).toBeNull();
    expect(normalizeFriendCode("ABCDEFG")).toBeNull();
    expect(formatFriendCode("ABCDEF")).toBe("ABC-DEF");
  });

  it("lists friends in a sentence without a doubled period", () => {
    expect(friendsSentence("With", ["Ana B."])).toBe("With Ana B.");
    expect(friendsSentence("With", ["Ana B.", "Cy"])).toBe(
      "With Ana B. and Cy.",
    );
    expect(friendsSentence("With", ["A", "B", "C D."])).toBe(
      "With A, B and C D.",
    );
  });
});
