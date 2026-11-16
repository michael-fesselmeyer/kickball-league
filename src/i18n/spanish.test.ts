import { describe, expect, it } from "vitest";
import { dayLine, gameWords, updatedWords } from "@/domain/gameday/status";
import { dayHeading, kickoff, shortDay } from "@/domain/schedule/format";
import {
  type PublicGame,
  resultLine,
  statusLabel,
} from "@/domain/schedule/public-game";
import { whenLine } from "@/domain/events/event";
import { priceLine } from "@/domain/events/tickets";
import { roundNameIn, sourceLabel } from "@/domain/playoffs/playoffs";
import { positionLabel } from "@/domain/scores/live";
import { dealWhen } from "@/domain/sponsors/deals";
import { movementWords } from "@/domain/stats/power";
import {
  outcomeLetters,
  streakLabel,
  streakNote,
} from "@/domain/stats/streaks";
import { formatOrdinal } from "./format";
import { ruleSetSummary } from "@/domain/season/divisions";

/**
 * The public pages' shared helpers in Spanish (ADR 0094). English stays
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

describe("standings, stats and brackets", () => {
  it("write results with Spanish letters and words", () => {
    expect(outcomeLetters("WWLTW", "es")).toBe("GGPEG");
    expect(outcomeLetters("WWLTW")).toBe("WWLTW");
    expect(streakLabel({ outcome: "W", length: 3 }, "es")).toBe("G3");
    expect(movementWords(2, "es")).toBe("Sube 2 puestos");
    expect(movementWords(-1, "es")).toBe("Baja 1 puesto");
    expect(movementWords(-1)).toBe("Down 1 place");
    expect(streakNote("Bees", { outcome: "L", length: 2 }, "es")).toBe(
      "Bees perdió 2 seguidos y ya le toca ganar.",
    );
  });

  it("name playoff rounds and where a team comes from", () => {
    expect(roundNameIn(3, 3, "es")).toBe("Final");
    expect(roundNameIn(2, 3, "es")).toBe("Semifinales");
    expect(roundNameIn(1, 4, "es")).toBe("Ronda 1");
    expect(sourceLabel({ seed: 4 }, 3, "es")).toBe("Posición 4");
    expect(sourceLabel({ winnerOf: "r2m1" }, 3, "es")).toBe(
      "Ganador de la semifinal 1",
    );
    expect(sourceLabel({ winnerOf: "r2m1" }, 3)).toBe("Winner of semifinal 1");
  });

  it("count innings and places the Spanish way", () => {
    expect(formatOrdinal("es", 3, "feminine")).toBe("3.ª");
    expect(formatOrdinal("es", 2)).toBe("2.º");
    expect(formatOrdinal("en", 22)).toBe("22nd");
    expect(positionLabel({ inning: 4, half: "bottom" })).toBe(
      "Bottom of the 4th",
    );
  });
});

describe("events and sponsors", () => {
  it("say when, how much and how many spots", () => {
    const e = {
      kind: "bar_night" as const,
      startsAt: at,
      endsAt: new Date(at.getTime() + 2 * 3_600_000),
    };
    expect(whenLine(e, NY, "es")).toMatch(/^sáb, 10 de abr/);
    expect(whenLine(e, NY)).toBe("Sat, Apr 10, 7:30 PM – 9:30 PM");
    expect(
      priceLine({ ticketPriceCents: 1500, memberPriceCents: 0 }, "es"),
    ).toMatch(/^Gratis para miembros, .*15/);
    expect(priceLine({ ticketPriceCents: 1500, memberPriceCents: 1000 })).toBe(
      "$15 ($10 for members)",
    );
  });

  it("write a deal's days and hours", () => {
    const deal = { validDays: [2, 4], validFrom: "18:00", validTo: "22:00" };
    expect(dealWhen(deal, "es")).toMatch(
      /^Los martes y los jueves, de 6\s?p\.\s?m\. a 10\s?p\.\s?m\.$/,
    );
    expect(dealWhen(deal)).toBe("Tuesdays and Thursdays, 6 PM to 10 PM");
    expect(
      dealWhen({ validDays: [], validFrom: null, validTo: null }, "es"),
    ).toBe("Todos los días");
  });
});

describe("game results and share messages", () => {
  const game = {
    id: "g1",
    status: "forfeit",
    slotCancelled: false,
    forfeitBy: "a",
    teamA: { id: "a", name: "Aces" },
    teamB: { id: "b", name: "Bees" },
    scoreA: null,
    scoreB: null,
  } as unknown as PublicGame;

  it("say who won in each language", () => {
    expect(resultLine(game, "es")).toBe("Bees gana por abandono");
    expect(resultLine(game)).toBe("Bees win by forfeit");
  });
});
