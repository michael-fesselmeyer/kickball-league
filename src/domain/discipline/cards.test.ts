import { describe, expect, it } from "vitest";
import { err, ok } from "../result";
import {
  canGiveCard,
  canUndoCard,
  CARD_NOTE_MAX,
  CARD_WINDOW_MS,
  cardChoice,
  parseCardForm,
  patternNote,
  UNDO_WINDOW_MS,
} from "./cards";

const T0 = new Date("2026-09-15T23:00:00Z");
const after = (ms: number) => new Date(T0.getTime() + ms);
const choices = new Set([
  cardChoice("team-a", "u1"),
  cardChoice("team-b", "u1"),
]);

describe("parseCardForm", () => {
  it("reads a color, a note and the player with their team", () => {
    expect(
      parseCardForm(
        { color: "yellow", note: "  Arguing the call  ", person: "team-a:u1" },
        choices,
      ),
    ).toEqual(
      ok({
        color: "yellow",
        note: "Arguing the call",
        userId: "u1",
        teamSeasonId: "team-a",
      }),
    );
  });

  it("keeps a co-rostered player's two teams apart", () => {
    const b = parseCardForm(
      { color: "red", note: "", person: "team-b:u1" },
      choices,
    );
    expect(b).toEqual(
      ok({ color: "red", note: null, userId: "u1", teamSeasonId: "team-b" }),
    );
  });

  it("rejects an unknown color, person or a long note", () => {
    const base = { color: "yellow", note: "", person: "team-a:u1" };
    expect(parseCardForm({ ...base, color: "blue" }, choices)).toEqual(
      err("bad_color"),
    );
    expect(parseCardForm({ ...base, person: "team-a:u9" }, choices)).toEqual(
      err("unknown_person"),
    );
    expect(
      parseCardForm({ ...base, note: "x".repeat(CARD_NOTE_MAX + 1) }, choices),
    ).toEqual(err("note_too_long"));
  });
});

describe("canGiveCard", () => {
  const game = (status: string, startsAt: Date | null) => ({
    status,
    startsAt,
  });
  it("opens at kickoff and stays open after the game ends", () => {
    expect(canGiveCard(game("scheduled", after(3_600_000)), T0)).toEqual(
      err("not_started"),
    );
    expect(canGiveCard(game("in_progress", T0), after(60_000))).toEqual(
      ok(undefined),
    );
    expect(canGiveCard(game("final", T0), after(2 * 3_600_000))).toEqual(
      ok(undefined),
    );
  });
  it("closes for a called-off game and after a couple of days", () => {
    expect(canGiveCard(game("cancelled", T0), after(60_000))).toEqual(
      err("called_off"),
    );
    expect(canGiveCard(game("final", T0), after(CARD_WINDOW_MS + 1))).toEqual(
      err("too_late"),
    );
  });
  it("lets an admin give one for an older game", () => {
    const old = game("final", T0);
    const late = after(CARD_WINDOW_MS + 1);
    expect(canGiveCard(old, late, { isAdmin: true })).toEqual(ok(undefined));
    expect(canGiveCard(game("cancelled", T0), late, { isAdmin: true })).toEqual(
      err("called_off"),
    );
  });
});

describe("canUndoCard", () => {
  const card = { givenBy: "ref", givenAt: T0 };
  it("lets the giver undo within the window only", () => {
    const ref = { userId: "ref", isAdmin: false };
    expect(canUndoCard(card, ref, after(UNDO_WINDOW_MS))).toBe(true);
    expect(canUndoCard(card, ref, after(UNDO_WINDOW_MS + 1))).toBe(false);
  });
  it("keeps other people out, and always lets an admin", () => {
    expect(
      canUndoCard(card, { userId: "other", isAdmin: false }, after(1000)),
    ).toBe(false);
    expect(
      canUndoCard(card, { userId: "admin", isAdmin: true }, after(86_400_000)),
    ).toBe(true);
    expect(
      canUndoCard(
        { givenBy: null, givenAt: T0 },
        { userId: "ref", isAdmin: false },
        after(1000),
      ),
    ).toBe(false);
  });
});

describe("patternNote", () => {
  const card = (gameId: string) => ({ gameId, color: "yellow" as const });
  it("stays quiet for a few cards in one night", () => {
    expect(patternNote([card("g1"), card("g1"), card("g1")])).toBeNull();
    expect(patternNote([card("g1"), card("g2")])).toBeNull();
  });
  it("appears after several cards across different games, without suggesting a suspension", () => {
    const note = patternNote([card("g1"), card("g2"), card("g3")]);
    expect(note).toContain("3 cards across 3 games");
    expect(note).toContain("never lead to a suspension");
  });
});
