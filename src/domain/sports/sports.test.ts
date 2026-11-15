import { describe, expect, it } from "vitest";
import { SPORTS } from "@/domain/league/new-league";
import { checkScore } from "./kickball";
import {
  calledNote,
  hasOwnRules,
  KICKBALL_FORM,
  scoreFormRules,
  scoreUnits,
  sportRules,
} from "./sports";

describe("sportRules", () => {
  it("gives kickball its own rules, as before sports had rules", () => {
    const rules = sportRules("kickball");
    expect(rules.key).toBe("kickball");
    expect(rules.score.check).toBe(checkScore);
    expect(rules.score.differenceCap).toBe(10);
    expect(rules.score.liveScoring).toBe(true);
    expect(rules.place.outdoors).toBe(true);
  });

  it("plays every sport without a module by kickball's rules", () => {
    for (const sport of SPORTS.map((s) => s.value))
      if (!hasOwnRules(sport)) expect(sportRules(sport).key).toBe("kickball");
    expect(sportRules(null).key).toBe("kickball");
    expect(sportRules("curling").key).toBe("kickball");
  });

  it("plays dodgeball in sets, indoors, without live scoring or a cap", () => {
    const rules = sportRules("dodgeball");
    expect(rules.key).toBe("dodgeball");
    expect(rules.score.unit.many).toBe("sets");
    expect(rules.score.period).toBeNull();
    expect(rules.score.differenceCap).toBeNull();
    expect(rules.score.liveScoring).toBe(false);
    expect(rules.score.max(7)).toBe(4);
    expect(rules.score.max(null)).toBe(3);
    expect(rules.place).toMatchObject({ one: "court", outdoors: false });
    expect(rules.tiebreakers.run_difference).toBe("set difference");
  });

  it("names a sport's units", () => {
    expect(scoreUnits(sportRules("kickball"), 1)).toBe("1 run");
    expect(scoreUnits(sportRules("dodgeball"), 3)).toBe("3 sets");
  });
});

describe("scoreFormRules", () => {
  it("keeps kickball's score form as it was", () => {
    expect(KICKBALL_FORM).toEqual({
      unit: "runs",
      max: 99,
      period: "innings",
      minPeriods: 4,
      calledRule:
        "A called game counts after 4 complete innings, with the score at the last complete inning.",
    });
  });

  it("asks dodgeball for sets up to the majority, with no periods", () => {
    expect(scoreFormRules(sportRules("dodgeball"), 3)).toEqual({
      unit: "sets",
      max: 2,
      period: null,
      minPeriods: 0,
      calledRule:
        "A match called early, before either team wins 2 sets, counts with the sets as they stand.",
    });
  });

  it("notes a called game with or without periods", () => {
    expect(calledNote(5)).toBe(" (called after 5 innings)");
    expect(calledNote(null)).toBe(" (called early)");
  });
});
