import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOVE_SCRIPT,
  fieldDayWords,
  ITEM_MAX,
  ITEMS_PER_PHASE_MAX,
  NOTE_MAX,
  needsAdmins,
  parseChecklistForm,
  parseFieldCheckForm,
  parseMoveForm,
  parseNote,
  parseTick,
  SCRIPT_MAX,
} from "./checklist";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";

describe("parseChecklistForm", () => {
  it("reads one item per line, trimmed, blank lines dropped, repeats kept once", () => {
    const parsed = parseChecklistForm(
      form({
        before: "  Permit   ready \n\nNo glass\nNo glass\r\n",
        after: "Trash out",
        script: "  Hi there  ",
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        items: { before: ["Permit ready", "No glass"], after: ["Trash out"] },
        script: "Hi there",
      },
    });
  });

  it("keeps the default script when it is empty or left as it was", () => {
    for (const script of ["", "   ", DEFAULT_MOVE_SCRIPT]) {
      const parsed = parseChecklistForm(form({ before: "A", script }));
      expect(parsed.ok && parsed.value.script).toBeNull();
    }
    const missing = parseChecklistForm(form({ after: "A" }));
    expect(missing.ok && missing.value).toEqual({
      items: { before: [], after: ["A"] },
      script: null,
    });
  });

  it("needs at least one item across both lists", () => {
    expect(parseChecklistForm(form({ before: "\n \n", after: "" }))).toEqual({
      ok: false,
      error: "no_items",
    });
  });

  it("refuses an item or script that is too long, or too many items", () => {
    expect(
      parseChecklistForm(form({ before: "x".repeat(ITEM_MAX + 1) })),
    ).toEqual({ ok: false, error: "item_too_long" });
    expect(parseChecklistForm(form({ before: "x".repeat(ITEM_MAX) })).ok).toBe(
      true,
    );
    const many = Array.from(
      { length: ITEMS_PER_PHASE_MAX + 1 },
      (_, n) => `Item ${n}`,
    ).join("\n");
    expect(parseChecklistForm(form({ after: many }))).toEqual({
      ok: false,
      error: "too_many_items",
    });
    expect(
      parseChecklistForm(
        form({ before: "A", script: "x".repeat(SCRIPT_MAX + 1) }),
      ),
    ).toEqual({ ok: false, error: "script_too_long" });
  });
});

describe("notes and the move form", () => {
  it("reads an optional note", () => {
    expect(parseNote(null)).toEqual({ ok: true, value: null });
    expect(parseNote("  ")).toEqual({ ok: true, value: null });
    expect(parseNote(" Loud group ")).toEqual({ ok: true, value: "Loud group" });
    expect(parseNote("x".repeat(NOTE_MAX + 1))).toEqual({
      ok: false,
      error: "note_too_long",
    });
  });

  it("needs a known outcome", () => {
    expect(parseMoveForm(form({ outcome: "refused", note: "" }))).toEqual({
      ok: true,
      value: { outcome: "refused", note: null },
    });
    expect(parseMoveForm(form({ outcome: "shrugged" }))).toEqual({
      ok: false,
      error: "pick_outcome",
    });
    expect(parseMoveForm(form({}))).toEqual({
      ok: false,
      error: "pick_outcome",
    });
    expect(
      parseMoveForm(form({ outcome: "fine", note: "x".repeat(NOTE_MAX + 1) })),
    ).toEqual({ ok: false, error: "note_too_long" });
  });

  it("sends anything but fine to the admins", () => {
    expect(needsAdmins("fine")).toBe(false);
    expect(needsAdmins("refused")).toBe(true);
    expect(needsAdmins("complaint")).toBe(true);
  });
});

describe("parseFieldCheckForm", () => {
  it("takes fine with or without a note", () => {
    expect(parseFieldCheckForm(form({ status: "ok" }))).toEqual({
      ok: true,
      value: { status: "ok", note: null },
    });
    expect(
      parseFieldCheckForm(form({ status: "ok", note: "One bag left" })),
    ).toEqual({ ok: true, value: { status: "ok", note: "One bag left" } });
  });

  it("needs a note saying what the problem was", () => {
    expect(parseFieldCheckForm(form({ status: "problem" }))).toEqual({
      ok: false,
      error: "say_what",
    });
    expect(
      parseFieldCheckForm(form({ status: "problem", note: "Broken glass" })),
    ).toEqual({ ok: true, value: { status: "problem", note: "Broken glass" } });
    expect(
      parseFieldCheckForm(
        form({ status: "problem", note: "x".repeat(NOTE_MAX + 1) }),
      ),
    ).toEqual({ ok: false, error: "note_too_long" });
  });

  it("needs a status", () => {
    expect(parseFieldCheckForm(form({ status: "maybe" }))).toEqual({
      ok: false,
      error: "pick_status",
    });
  });
});

describe("fieldDayWords", () => {
  const end = new Date("2026-09-15T01:00:00Z");
  const before = new Date("2026-09-14T23:00:00Z");
  const after = new Date("2026-09-15T02:00:00Z");

  it("says what is still to come before the last game ends", () => {
    expect(
      fieldDayWords({ setup: null, close: null, lastGameEndsAt: end }, before),
    ).toEqual({
      setup: "Set-up not confirmed yet",
      close: "After the last game",
    });
  });

  it("flags a field nobody closed after its last game", () => {
    expect(
      fieldDayWords({ setup: null, close: null, lastGameEndsAt: end }, after)
        .close,
    ).toBe("Not confirmed after the last game");
  });

  it("names confirmed checks and problems", () => {
    expect(
      fieldDayWords(
        {
          setup: { status: "ok", at: before },
          close: { status: "ok", at: after },
          lastGameEndsAt: end,
        },
        after,
      ),
    ).toEqual({ setup: "Set-up confirmed", close: "Left clean" });
    expect(
      fieldDayWords(
        {
          setup: { status: "problem", at: before },
          close: { status: "problem", at: after },
          lastGameEndsAt: end,
        },
        after,
      ),
    ).toEqual({
      setup: "Set-up problem noted",
      close: "Problem noted after play",
    });
  });
});

describe("parseTick", () => {
  it("reads a sound tick", () => {
    expect(parseTick({ teamSeasonId: ID_A, itemId: ID_B, on: false })).toEqual(
      { teamSeasonId: ID_A, itemId: ID_B, on: false },
    );
  });

  it("refuses anything else", () => {
    for (const body of [
      null,
      "tick",
      [],
      { teamSeasonId: ID_A, itemId: ID_B },
      { teamSeasonId: ID_A, itemId: ID_B, on: "true" },
      { teamSeasonId: "nope", itemId: ID_B, on: true },
      { teamSeasonId: ID_A, itemId: 7, on: true },
    ])
      expect(parseTick(body)).toBeNull();
  });
});
