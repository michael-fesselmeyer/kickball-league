import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatFriendCode,
  newFriendCode,
  normalizeFriendCode,
} from "./friend-code";
import { labelOf, parseQuiz, QUESTIONS, readAnswers } from "./quiz";

const complete = {
  experience: "some",
  positions: ["outfield", "pitcher", "goalie"],
  availability: "most_weeks",
  vibe: "social",
  captain: "yes",
  notes: "  Lefty   kicker ",
};

describe("parseQuiz", () => {
  it("scores the answers and keeps positions in a fixed order", () => {
    expect(parseQuiz(complete)).toEqual({
      ok: true,
      value: {
        answers: {
          version: 1,
          experience: "some",
          positions: ["pitcher", "outfield"],
          availability: "most_weeks",
          vibe: "social",
          captain: "yes",
        },
        skillScore: 3,
        vibeScore: 1,
        wouldCaptain: true,
        notes: "Lefty kicker",
      },
    });
  });

  it.each([
    ["experience", "missing_experience"],
    ["availability", "missing_availability"],
    ["vibe", "missing_vibe"],
    ["captain", "missing_captain"],
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

  it("stays short enough for under two minutes", () => {
    expect(Object.keys(QUESTIONS)).toHaveLength(5);
    for (const q of Object.values(QUESTIONS))
      expect(q.choices.length).toBeLessThanOrEqual(5);
  });

  it("reads stored answers back, and refuses junk", () => {
    const parsed = parseQuiz(complete);
    if (!parsed.ok) throw new Error("expected a parse");
    expect(readAnswers(parsed.value.answers)).toEqual(parsed.value.answers);
    expect(readAnswers({ experience: "x" })).toBeNull();
    expect(readAnswers(null)).toBeNull();
  });

  it("labels answers in the players' words", () => {
    expect(labelOf("vibe", "competitive")).toBe("Here to win it all");
    expect(labelOf("vibe", "unknown")).toBe("unknown");
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
});
