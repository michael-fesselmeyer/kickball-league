import { describe, expect, it } from "vitest";
import { zonedInstant } from "../time/zoned";
import {
  COUNTDOWN_MINUTES,
  countdown,
  nextHandovers,
  overlapWarnings,
  parseGroup,
  usualSpans,
  weekdayOf,
} from "./groups";

const NY = "America/New_York";
const at = (date: string, time: string) => zonedInstant(date, time, NY);

const raw = (over: Partial<Parameters<typeof parseGroup>[0]> = {}) => ({
  name: "Tuesday Softball",
  weekdays: ["2"],
  startsAt: "18:00",
  endsAt: "20:00",
  contact: "",
  ...over,
});

describe("parseGroup", () => {
  it("accepts a group with days and hours", () => {
    const r = parseGroup(raw({ weekdays: ["4", "2", "2"], contact: " 555 " }));
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Tuesday Softball",
        weekdays: [2, 4],
        startsAt: "18:00",
        endsAt: "20:00",
        contact: "555",
      },
    });
  });

  it("accepts a name alone: a group with no usual hours", () => {
    const r = parseGroup(raw({ weekdays: [], startsAt: "", endsAt: "" }));
    expect(r.ok && r.value).toMatchObject({
      weekdays: [],
      startsAt: null,
      endsAt: null,
      contact: null,
    });
  });

  it("rejects a blank or over-long name", () => {
    expect(parseGroup(raw({ name: "  " }))).toEqual({
      ok: false,
      error: "name",
    });
    expect(parseGroup(raw({ name: "x".repeat(81) }))).toEqual({
      ok: false,
      error: "name",
    });
  });

  it("rejects hours without days, days without hours, and bad clocks", () => {
    expect(parseGroup(raw({ weekdays: [] }))).toEqual({
      ok: false,
      error: "weekdays",
    });
    expect(parseGroup(raw({ endsAt: "" }))).toEqual({
      ok: false,
      error: "hours",
    });
    expect(parseGroup(raw({ startsAt: "25:00" }))).toEqual({
      ok: false,
      error: "hours",
    });
    expect(parseGroup(raw({ weekdays: ["7"] }))).toEqual({
      ok: false,
      error: "weekdays",
    });
  });

  it("rejects equal start and end, but allows an end before the start", () => {
    expect(parseGroup(raw({ endsAt: "18:00" }))).toEqual({
      ok: false,
      error: "hours_same",
    });
    expect(parseGroup(raw({ startsAt: "22:00", endsAt: "01:00" })).ok).toBe(
      true,
    );
  });

  it("rejects a contact over the limit", () => {
    expect(parseGroup(raw({ contact: "x".repeat(201) }))).toEqual({
      ok: false,
      error: "contact",
    });
  });
});

describe("usualSpans", () => {
  // 2027-04-06 is a Tuesday.
  it("places hours on their weekday only", () => {
    expect(weekdayOf("2027-04-06")).toBe(2);
    const usual = { weekdays: [2], startsAt: "18:00", endsAt: "20:00" };
    expect(usualSpans(usual, "2027-04-06", NY)).toEqual([
      { start: at("2027-04-06", "18:00"), end: at("2027-04-06", "20:00") },
    ]);
    expect(usualSpans(usual, "2027-04-07", NY)).toEqual([]);
  });

  it("carries hours past midnight into the next day", () => {
    const usual = { weekdays: [2], startsAt: "22:00", endsAt: "01:00" };
    expect(usualSpans(usual, "2027-04-06", NY)).toEqual([
      { start: at("2027-04-06", "22:00"), end: at("2027-04-07", "01:00") },
    ]);
    // Wednesday morning is still the Tuesday night group's tail.
    expect(usualSpans(usual, "2027-04-07", NY)).toEqual([
      { start: at("2027-04-06", "22:00"), end: at("2027-04-07", "01:00") },
    ]);
  });

  it("is empty for a group with no usual hours", () => {
    expect(
      usualSpans(
        { weekdays: [], startsAt: null, endsAt: null },
        "2027-04-06",
        NY,
      ),
    ).toEqual([]);
  });

  it("keeps wall-clock hours across the spring-forward night", () => {
    // 2027-03-14 is the spring-forward Sunday; 01:00 to 04:00 is two real hours.
    const usual = { weekdays: [6], startsAt: "23:00", endsAt: "04:00" };
    const [span] = usualSpans(usual, "2027-03-14", NY);
    expect(span).toBeDefined();
    expect((span!.end.getTime() - span!.start.getTime()) / 3_600_000).toBe(4);
  });

  it("reads 20:00 as 20:00 local the day after the clocks go back", () => {
    const usual = { weekdays: [1], startsAt: "20:00", endsAt: "22:00" };
    const [span] = usualSpans(usual, "2027-11-08", NY);
    expect(span?.start).toEqual(at("2027-11-08", "20:00"));
  });
});

describe("nextHandovers", () => {
  const date = "2027-04-06";
  const ours = { start: at(date, "20:00"), end: at(date, "22:00") };
  const group = (over: object) => ({
    id: "g1",
    fieldId: "f1",
    name: "Softball",
    weekdays: [2],
    startsAt: "22:00",
    endsAt: "23:30",
    ...over,
  });
  const run = (groups: ReturnType<typeof group>[], now: Date) =>
    nextHandovers({ groups, ours, date, timeZone: NY, now });

  it("hands the field to a group that comes on after us when our hold ends", () => {
    const [h] = run([group({})], at(date, "19:00"));
    expect(h).toMatchObject({ kind: "after", group: "Softball", at: ours.end });
    expect(h?.usual).toEqual(at(date, "22:00"));
  });

  it("takes the field from a group on before us when our hold starts", () => {
    const [h] = run(
      [group({ startsAt: "18:00", endsAt: "19:45" })],
      at(date, "17:00"),
    );
    expect(h).toMatchObject({ kind: "before", at: ours.start });
    expect(h?.usual).toEqual(at(date, "19:45"));
  });

  it("flags usual hours that cut into ours as an overlap", () => {
    const [h] = run(
      [group({ startsAt: "21:00", endsAt: "23:00" })],
      at(date, "19:00"),
    );
    expect(h).toMatchObject({ kind: "overlap", at: at(date, "21:00") });
    const [early] = run(
      [group({ startsAt: "19:00", endsAt: "21:00" })],
      at(date, "18:00"),
    );
    expect(early).toMatchObject({ kind: "overlap", at: ours.start });
  });

  it("lists the soonest first and drops handovers already past", () => {
    const before = group({
      id: "b",
      name: "Early",
      startsAt: "18:00",
      endsAt: "19:45",
    });
    const after = group({ id: "a" });
    expect(
      run([after, before], at(date, "19:00")).map((h) => h.groupId),
    ).toEqual(["b", "a"]);
    expect(
      run([after, before], at(date, "20:30")).map((h) => h.groupId),
    ).toEqual(["a"]);
    expect(
      run([after, before], at(date, "22:00")).map((h) => h.groupId),
    ).toEqual(["a"]);
    expect(run([after, before], at(date, "22:01"))).toEqual([]);
  });

  it("ignores groups that don't use the field that weekday or have no hours", () => {
    expect(
      run(
        [
          group({ weekdays: [3] }),
          group({ id: "none", weekdays: [], startsAt: null, endsAt: null }),
        ],
        at(date, "19:00"),
      ),
    ).toEqual([]);
  });

  it("finds a night group whose hours began the evening before our morning game", () => {
    const morning = {
      start: at("2027-04-07", "00:30"),
      end: at("2027-04-07", "02:00"),
    };
    const [h] = nextHandovers({
      groups: [group({ startsAt: "22:00", endsAt: "01:00" })],
      ours: morning,
      date: "2027-04-07",
      timeZone: NY,
      now: at("2027-04-07", "00:00"),
    });
    expect(h?.kind).toBe("overlap");
  });
});

describe("countdown", () => {
  const handover = at("2027-04-06", "22:00");
  it("starts in the last half hour and counts whole minutes up", () => {
    expect(countdown(handover, at("2027-04-06", "21:29"))).toBeNull();
    expect(countdown(handover, at("2027-04-06", "21:30"))).toBe(
      COUNTDOWN_MINUTES,
    );
    expect(countdown(handover, new Date(handover.getTime() - 90_000))).toBe(2);
    expect(countdown(handover, new Date(handover.getTime() - 1_000))).toBe(1);
  });

  it("is null once the handover has come", () => {
    expect(countdown(handover, handover)).toBeNull();
    expect(countdown(handover, at("2027-04-06", "22:10"))).toBeNull();
  });

  it("counts across midnight", () => {
    const late = at("2027-04-07", "00:10");
    expect(countdown(late, at("2027-04-06", "23:50"))).toBe(20);
  });

  it("counts real minutes across the spring-forward hour", () => {
    // 01:50 EST to 03:10 EDT is 20 real minutes.
    expect(
      countdown(at("2027-03-14", "03:10"), at("2027-03-14", "01:50")),
    ).toBe(20);
  });
});

describe("overlapWarnings", () => {
  const overlap = (over: object) => ({
    id: "o1",
    groupId: "g1",
    group: "Softball",
    fieldId: "f1",
    on: "2027-04-06",
    note: null,
    ...over,
  });
  const base = {
    today: "2027-04-01",
    held: new Set(["2027-04-06/f1"]),
    rainedOut: new Set<string>(),
    blackouts: new Set<string>(),
  };

  it("warns for an upcoming overlap on a field the league holds", () => {
    const [w] = overlapWarnings({ ...base, overlaps: [overlap({})] });
    expect(w).toMatchObject({ stillNeeded: true, reason: null });
  });

  it("drops past overlaps and keeps today's", () => {
    const out = overlapWarnings({
      ...base,
      today: "2027-04-06",
      overlaps: [overlap({ id: "past", on: "2027-04-05" }), overlap({})],
    });
    expect(out.map((o) => o.id)).toEqual(["o1"]);
  });

  it("marks a rained-out day, a blackout and a lost permit as not needed", () => {
    const rained = overlapWarnings({
      ...base,
      rainedOut: new Set(["2027-04-06/f1"]),
      overlaps: [overlap({})],
    });
    expect(rained[0]).toMatchObject({
      stillNeeded: false,
      reason: "rained_out",
    });
    const out = overlapWarnings({
      ...base,
      blackouts: new Set(["2027-04-06"]),
      overlaps: [overlap({})],
    });
    expect(out[0]).toMatchObject({ stillNeeded: false, reason: "blackout" });
    const fieldOut = overlapWarnings({
      ...base,
      blackouts: new Set(["2027-04-06/f1"]),
      overlaps: [overlap({})],
    });
    expect(fieldOut[0]?.reason).toBe("blackout");
    const lost = overlapWarnings({
      ...base,
      held: new Set(),
      overlaps: [overlap({})],
    });
    expect(lost[0]).toMatchObject({ stillNeeded: false, reason: "no_permit" });
  });

  it("orders by date, then group", () => {
    const out = overlapWarnings({
      ...base,
      held: new Set(["2027-04-06/f1", "2027-04-08/f1"]),
      overlaps: [
        overlap({ id: "c", on: "2027-04-08" }),
        overlap({ id: "b", group: "Zumba" }),
        overlap({ id: "a" }),
      ],
    });
    expect(out.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });
});
