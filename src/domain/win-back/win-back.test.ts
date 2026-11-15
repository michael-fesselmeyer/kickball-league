import { describe, expect, it } from "vitest";
import type { UserId } from "../ids";
import {
  type Candidate,
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  fill,
  invitePath,
  paragraphsOf,
  parseTemplate,
  rankCandidates,
  stateOf,
  winBackMessage,
} from "./win-back";

const person = (over: Partial<Candidate>): Candidate => ({
  userId: "00000000-0000-4000-8000-000000000001" as UserId,
  firstName: "Robin",
  name: "Robin Example",
  seasonsPlayed: 1,
  lastSeasonStart: "2026-09-01",
  lastSeasonName: "Fall 2026",
  lastTeam: "Sun Kickers",
  lastRole: "player",
  optedOut: false,
  emailedAt: null,
  ...over,
});

describe("fill and paragraphsOf", () => {
  it("fills the three placeholders and leaves other braces alone", () => {
    expect(
      fill("Hi {first_name}, {season} with {team}? {other}", {
        first_name: "Robin",
        season: "Spring 2027",
        team: "Sun Kickers",
      }),
    ).toBe("Hi Robin, Spring 2027 with Sun Kickers? {other}");
  });

  it("splits paragraphs on blank lines", () => {
    expect(paragraphsOf("One\nstill one\r\n\r\n  Two  \n\n\n")).toEqual([
      "One\nstill one",
      "Two",
    ]);
  });
});

describe("parseTemplate", () => {
  it("trims and checks lengths", () => {
    expect(parseTemplate({ subject: "  Hi  ", body: " Body " })).toEqual({
      ok: true,
      value: { subject: "Hi", body: "Body" },
    });
    expect(parseTemplate({ subject: " ", body: "x" })).toEqual({
      ok: false,
      error: "subject",
    });
    expect(parseTemplate({ subject: "x".repeat(121), body: "x" }).ok).toBe(
      false,
    );
    expect(parseTemplate({ subject: "x", body: "x".repeat(2001) })).toEqual({
      ok: false,
      error: "body",
    });
  });
});

describe("invitePath", () => {
  it("sends captains to register a team and free agents to the free-agent page", () => {
    expect(invitePath("captain", "spring-2027").path).toBe(
      "/app/seasons/spring-2027/register",
    );
    expect(invitePath("free_agent", "spring-2027").path).toBe("/free-agents");
    expect(invitePath("player", "spring-2027").path).toBe(
      "/app/seasons/spring-2027",
    );
  });
});

describe("rankCandidates and stateOf", () => {
  it("puts the most loyal first, then the most recent, then by name", () => {
    const ranked = rankCandidates([
      person({
        name: "Casey C",
        seasonsPlayed: 1,
        lastSeasonStart: "2026-09-01",
      }),
      person({
        name: "Alex A",
        seasonsPlayed: 4,
        lastSeasonStart: "2026-04-01",
      }),
      person({ name: "Bo B", seasonsPlayed: 1, lastSeasonStart: "2026-04-01" }),
      person({
        name: "Ari A",
        seasonsPlayed: 1,
        lastSeasonStart: "2026-09-01",
      }),
    ]);
    expect(ranked.map((c) => c.name)).toEqual([
      "Alex A",
      "Ari A",
      "Casey C",
      "Bo B",
    ]);
  });

  it("knows who can still be emailed", () => {
    expect(stateOf(person({}))).toBe("ready");
    expect(stateOf(person({ optedOut: true }))).toBe("opted_out");
    // An email that went out before they opted out still counts as sent.
    expect(stateOf(person({ optedOut: true, emailedAt: new Date() }))).toBe(
      "emailed",
    );
  });
});

describe("winBackMessage", () => {
  it("fills the default wording and picks the right button", () => {
    const message = winBackMessage(
      { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY },
      person({ lastRole: "captain" }),
      { name: "Spring 2027", slug: "spring-2027" },
    );
    expect(message.subject).toBe("We saved you a spot for Spring 2027");
    expect(message.paragraphs[0]).toBe("Hi Robin,");
    expect(message.paragraphs[1]).toContain(
      "Last time you played with Sun Kickers.",
    );
    expect(message.actionLabel).toBe("Register your team");
    expect(message.actionPath).toBe("/app/seasons/spring-2027/register");
  });

  it("says the league when they never joined a team", () => {
    const message = winBackMessage(
      { subject: "{season}", body: "With {team}" },
      person({ lastTeam: null, lastRole: "free_agent" }),
      { name: "Spring 2027", slug: "spring-2027" },
    );
    expect(message.paragraphs).toEqual(["With the league"]);
    expect(message.actionPath).toBe("/free-agents");
  });
});
