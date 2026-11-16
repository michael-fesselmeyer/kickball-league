import { describe, expect, it } from "vitest";
import {
  ALERT_CARDS,
  type AlertCard,
  BETWEEN_CARDS_DAYS,
  CARD_COPY,
  type CardMoments,
  cardsForTopic,
  NO_THANKS_QUIET_DAYS,
  nextCard,
  type PastAnswer,
} from "./alert-cards";

const NOW = new Date("2026-07-01T16:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const NONE: CardMoments = {
  rsvped: false,
  onTeam: false,
  playedGame: false,
  seasonEnded: false,
};

const card = (
  moments: Partial<CardMoments>,
  {
    answers = [],
    alreadyOn = [],
    unavailable = [],
  }: {
    answers?: PastAnswer[];
    alreadyOn?: AlertCard[];
    unavailable?: ("push" | "email")[];
  } = {},
) =>
  nextCard({
    moments: { ...NONE, ...moments },
    answers,
    alreadyOn: new Set(alreadyOn),
    unavailable: new Set(unavailable),
    now: NOW,
  });

describe("nextCard", () => {
  it("shows nothing before any moment has come, as on a first visit", () => {
    expect(card({})).toBeNull();
  });

  it("offers rain-out alerts after a first RSVP", () => {
    expect(card({ rsvped: true })).toBe("first_rsvp");
  });

  it("offers sub requests on joining a team", () => {
    expect(card({ onTeam: true })).toBe("joined_team");
  });

  it("offers the weekly roundup after a first game", () => {
    expect(card({ playedGame: true })).toBe("first_game");
  });

  it("offers next season's news at the end of a season", () => {
    expect(card({ seasonEnded: true })).toBe("season_end");
  });

  it("never stacks: one card at a time, in order", () => {
    expect(
      card({ rsvped: true, onTeam: true, playedGame: true, seasonEnded: true }),
    ).toBe("first_rsvp");
  });

  it("asks each card once, whatever the answer", () => {
    for (const answer of ["yes", "no"] as const)
      expect(
        card(
          { rsvped: true },
          { answers: [{ card: "first_rsvp", answer, at: ago(400) }] },
        ),
      ).toBeNull();
  });

  it("waits a week after any answer before the next card", () => {
    const yes = (days: number): PastAnswer[] => [
      { card: "first_rsvp", answer: "yes", at: ago(days) },
    ];
    const moments = { rsvped: true, onTeam: true };
    expect(card(moments, { answers: yes(BETWEEN_CARDS_DAYS - 1) })).toBeNull();
    expect(card(moments, { answers: yes(BETWEEN_CARDS_DAYS) })).toBe(
      "joined_team",
    );
  });

  it("stays quiet for a month after No thanks", () => {
    const no = (days: number): PastAnswer[] => [
      { card: "first_rsvp", answer: "no", at: ago(days) },
    ];
    const moments = { rsvped: true, onTeam: true };
    expect(card(moments, { answers: no(BETWEEN_CARDS_DAYS + 1) })).toBeNull();
    expect(card(moments, { answers: no(NO_THANKS_QUIET_DAYS - 1) })).toBeNull();
    expect(card(moments, { answers: no(NO_THANKS_QUIET_DAYS) })).toBe(
      "joined_team",
    );
  });

  it("counts the most recent No thanks, not the first answer", () => {
    expect(
      card(
        { rsvped: true, onTeam: true, playedGame: true },
        {
          answers: [
            { card: "first_rsvp", answer: "yes", at: ago(90) },
            { card: "joined_team", answer: "no", at: ago(10) },
          ],
        },
      ),
    ).toBeNull();
  });

  it("skips a card whose alerts are already on", () => {
    expect(
      card({ rsvped: true, onTeam: true }, { alreadyOn: ["first_rsvp"] }),
    ).toBe("joined_team");
  });

  it("skips push cards when the league can't send push", () => {
    expect(
      card(
        { rsvped: true, onTeam: true, playedGame: true },
        { unavailable: ["push"] },
      ),
    ).toBe("first_game");
  });
});

describe("CARD_COPY", () => {
  it("gives every card a question, a sample and a Yes", () => {
    for (const c of ALERT_CARDS) {
      const copy = CARD_COPY[c];
      expect(copy.card).toBe(c);
      expect(copy.question).toMatch(/\?$/);
      expect(copy.sample.title.length).toBeGreaterThan(0);
      expect(copy.sample.body.length).toBeGreaterThan(0);
      expect(copy.yes).toMatch(/^Yes/);
    }
  });

  it("asks for push only for rain-outs and sub requests", () => {
    expect(
      ALERT_CARDS.filter((c) => CARD_COPY[c].channel === "push"),
    ).toEqual(["first_rsvp", "joined_team"]);
  });

  it("maps topics back to the cards that offer them", () => {
    expect(cardsForTopic("announcement")).toEqual(["first_game", "season_end"]);
    expect(cardsForTopic("payment")).toEqual([]);
  });
});
