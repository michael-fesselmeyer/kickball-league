import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMIT_END_RULE,
  permitEndFor,
  permitEndRule,
  permitWatch,
  type WatchInput,
} from "./permit-end";

const at = (hhmm: string, day = "2026-11-17") => new Date(`${day}T${hhmm}:00Z`);

const base: WatchInput = {
  permitEndsAt: at("02:00", "2026-11-18"),
  now: at("23:00"),
  startsAt: at("22:00"),
  timeLimitMinutes: 75,
  innings: 7,
  halvesEntered: 4,
  rule: "call_at_last_complete",
};

describe("permitEndRule", () => {
  it("reads the rule set's choice and falls back to calling the game", () => {
    expect(permitEndRule({ permitEndRule: "last_inning_to_start" })).toBe(
      "last_inning_to_start",
    );
    expect(permitEndRule({})).toBe(DEFAULT_PERMIT_END_RULE);
    expect(permitEndRule(null)).toBe(DEFAULT_PERMIT_END_RULE);
    expect(permitEndRule({ permitEndRule: "nonsense" })).toBe(
      DEFAULT_PERMIT_END_RULE,
    );
  });
});

describe("permitEndFor", () => {
  const own = { startsAt: at("22:00"), endsAt: at("23:00") };

  it("is the window's own end with nothing next to it", () => {
    expect(permitEndFor(own, [])).toEqual(at("23:00"));
  });

  it("runs through windows that touch, in any order", () => {
    const next = { startsAt: at("23:00"), endsAt: at("23:30") };
    const after = { startsAt: at("23:30"), endsAt: at("00:30", "2026-11-18") };
    expect(permitEndFor(own, [after, next])).toEqual(at("00:30", "2026-11-18"));
  });

  it("stops at a gap, where the league does not hold the field", () => {
    const later = { startsAt: at("23:15"), endsAt: at("23:45") };
    expect(permitEndFor(own, [later])).toEqual(at("23:00"));
  });

  it("ignores a window inside the one it has", () => {
    const inside = { startsAt: at("22:10"), endsAt: at("22:50") };
    expect(permitEndFor(own, [inside])).toEqual(at("23:00"));
  });
});

describe("permitWatch", () => {
  it("is null for a game with no permit window", () => {
    expect(permitWatch({ ...base, permitEndsAt: null })).toBeNull();
  });

  it("counts the minutes left, rounding up, across midnight", () => {
    const watch = permitWatch({
      ...base,
      halvesEntered: 14,
      now: new Date(at("02:00", "2026-11-18").getTime() - 30.5 * 60_000),
    });
    expect(watch?.minutesLeft).toBe(31);
    expect(watch?.level).toBe("ok");
    expect(watch?.message).toBe("31 minutes left in the permit.");
  });

  it("warns when the time limit would end after the permit does", () => {
    const watch = permitWatch({
      ...base,
      timeLimitMinutes: 240,
      permitEndsAt: at("23:30"),
    });
    expect(watch?.level).toBe("watch");
    expect(watch?.reason).toBe("time_limit");
    expect(watch?.message).toContain("30 minutes");
    expect(watch?.message).toContain("last complete inning");
  });

  it("warns from the pace when the innings left would not fit", () => {
    // Four half-innings in an hour: 15 minutes each, ten halves left.
    const watch = permitWatch({
      ...base,
      timeLimitMinutes: null,
      permitEndsAt: at("00:00", "2026-11-18"),
    });
    expect(watch?.reason).toBe("pace");
    expect(watch?.level).toBe("watch");
  });

  it("is quiet while the pace fits", () => {
    const watch = permitWatch({
      ...base,
      timeLimitMinutes: null,
      permitEndsAt: at("02:00", "2026-11-18"),
    });
    expect(watch?.level).toBe("ok");
    expect(watch?.reason).toBeNull();
  });

  it("does not judge the pace before a couple of half-innings", () => {
    const watch = permitWatch({
      ...base,
      timeLimitMinutes: null,
      halvesEntered: 1,
      permitEndsAt: at("23:20"),
    });
    expect(watch?.level).toBe("ok");
  });

  it("does not project a pace for a game with no inning count", () => {
    const watch = permitWatch({
      ...base,
      timeLimitMinutes: null,
      innings: null,
      permitEndsAt: at("23:20"),
    });
    expect(watch?.level).toBe("ok");
  });

  it("says the permit has ended, and names the league's rule", () => {
    const watch = permitWatch({
      ...base,
      now: at("02:10", "2026-11-18"),
      rule: "last_inning_to_start",
    });
    expect(watch).toMatchObject({ level: "over", minutesLeft: 0 });
    expect(watch?.message).toBe(
      "The permit ended 10 minutes ago. No new inning starts once the permit has ended.",
    );
  });

  it("says just now in the first minute after the end", () => {
    const watch = permitWatch({
      ...base,
      now: new Date(at("02:00", "2026-11-18").getTime() + 30_000),
    });
    expect(watch?.level).toBe("over");
    expect(watch?.message).toContain("just now");
  });

  it("uses the singular for the last minute", () => {
    const watch = permitWatch({
      ...base,
      halvesEntered: 14,
      now: new Date(at("02:00", "2026-11-18").getTime() - 30_000),
    });
    expect(watch?.message).toBe("1 minute left in the permit.");
  });
});
