import { describe, expect, it } from "vitest";
import { dayLine, gameWords, updatedWords } from "@/domain/gameday/status";
import { dayHeading, kickoff, shortDay } from "@/domain/schedule/format";
import { type PublicGame, statusLabel } from "@/domain/schedule/public-game";
import { ruleSetSummary } from "@/domain/season/divisions";

/**
 * The public pages' shared helpers in Spanish (ADR 0065). English stays
 * the default for every caller that doesn't pass a language.
 */
const NY = "America/New_York";
const at = new Date("2027-04-10T23:30:00Z"); // 7:30 PM in New York

describe("dates and times", () => {
  it("are written the Spanish way, in the league's time zone", () => {
    expect(dayHeading("2027-04-10", "es")).toBe("sábado, 10 de abril");
    expect(dayHeading("2027-04-10")).toBe("Saturday, April 10");
    expect(kickoff(at, NY, "es")).toMatch(/^7:30\s?p\.\s?m\.$/);
    expect(kickoff(at, NY)).toBe("7:30 PM");
    expect(shortDay(at, NY, "es")).toMatch(/^sáb, 10 de abr/);
  });
});

describe("game and day status", () => {
  const game = { status: "final", slotCancelled: false } as PublicGame;

  it("labels a game in each language", () => {
    expect(statusLabel(game, "es")).toBe("Final");
    expect(statusLabel({ ...game, status: "in_progress" }, "es")).toBe(
      "En vivo",
    );
    expect(
      statusLabel({ ...game, slotCancelled: true, status: "scheduled" }),
    ).toBe("Rained out");
  });

  it("says what a day's status means, keeping the admin's reason as written", () => {
    const day = {
      state: "off" as const,
      decideBy: null,
      reason: "Field flooded",
      games: new Map(),
    };
    // No game singled out: the whole day.
    expect(dayLine(day, 0, NY, "es")).toBe(
      "Todos los partidos se suspenden. Field flooded.",
    );
    expect(dayLine(day, 0, NY)).toBe("All games are off. Field flooded.");
    expect(gameWords({ kind: "delayed", newStartsAt: at }, NY, "es")).toMatch(
      /^Empieza tarde: 7:30/,
    );
    expect(updatedWords(at, NY, "es")).toMatch(/^Actualizado 7:30/);
  });
});

describe("rule sets", () => {
  it("count innings with the right plural, in each language", () => {
    const rules = {
      innings: 1,
      timeLimitMinutes: 50,
      options: { bunting: false, stealing: true },
    };
    expect(ruleSetSummary(rules)).toBe(
      "1 inning · 50-minute limit · no bunting · stealing allowed",
    );
    expect(ruleSetSummary({ ...rules, innings: 7 }, "es")).toBe(
      "7 entradas · límite de 50 minutos · sin toques · se permite robar base",
    );
  });
});
