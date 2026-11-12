import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_REASON_LENGTH,
  MAX_REQUESTS_PER_TEAM,
  describeRequest,
  parseTeamRequest,
  requestsOpen,
  type RequestForm,
} from "./team-requests";

const SEASON = {
  startsOn: "2027-04-05",
  endsOn: "2027-06-28",
  timeIndexes: [0, 1, 2],
};
const form = (over: Partial<RequestForm>): RequestForm => ({
  kind: "unavailable",
  onDate: "2027-05-10",
  timeIndex: "",
  reason: "",
  ...over,
});

describe("parseTeamRequest", () => {
  it("accepts a whole-day conflict", () => {
    expect(parseTeamRequest(form({}), SEASON, 0)).toEqual({
      ok: true,
      value: {
        kind: "unavailable",
        onDate: "2027-05-10",
        timeIndex: null,
        reason: null,
      },
    });
  });

  it("accepts a preference for a time of day alone", () => {
    const result = parseTeamRequest(
      form({ kind: "prefer", onDate: "", timeIndex: "2", reason: " late " }),
      SEASON,
      3,
    );
    expect(result).toEqual({
      ok: true,
      value: { kind: "prefer", onDate: null, timeIndex: 2, reason: "late" },
    });
  });

  it.each([
    [{ kind: "maybe" }, "bad_kind"],
    [{ onDate: "2027-02-30" }, "bad_date"],
    [{ onDate: "May 10" }, "bad_date"],
    [{ onDate: "2027-07-01" }, "date_outside_season"],
    [{ onDate: "2027-04-04" }, "date_outside_season"],
    [{ timeIndex: "5" }, "bad_time"],
    [{ timeIndex: "1.5" }, "bad_time"],
    [{ onDate: "" }, "needs_date"],
    [{ kind: "avoid", onDate: "" }, "needs_date_or_time"],
    [{ reason: "x".repeat(MAX_REASON_LENGTH + 1) }, "reason_too_long"],
  ] as const)("rejects %j with %s", (over, error) => {
    expect(parseTeamRequest(form(over), SEASON, 0)).toEqual({
      ok: false,
      error,
    });
  });

  it("stops at the per-team limit", () => {
    expect(parseTeamRequest(form({}), SEASON, MAX_REQUESTS_PER_TEAM)).toEqual({
      ok: false,
      error: "too_many",
    });
  });

  it("never accepts a date outside the season or a time it doesn't use", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("unavailable", "prefer", "avoid"),
        fc.date({
          min: new Date("2027-01-01T00:00:00Z"),
          max: new Date("2027-12-31T00:00:00Z"),
          noInvalidDate: true,
        }),
        fc.option(fc.integer({ min: -2, max: 6 }), { nil: undefined }),
        (kind, date, time) => {
          const onDate = date.toISOString().slice(0, 10);
          const result = parseTeamRequest(
            form({
              kind,
              onDate,
              timeIndex: time === undefined ? "" : `${time}`,
            }),
            SEASON,
            0,
          );
          if (!result.ok) return;
          expect(result.value.onDate! >= SEASON.startsOn).toBe(true);
          expect(result.value.onDate! <= SEASON.endsOn).toBe(true);
          if (result.value.timeIndex !== null)
            expect(SEASON.timeIndexes).toContain(result.value.timeIndex);
        },
      ),
    );
  });
});

describe("requestsOpen", () => {
  it("closes when registration closes", () => {
    const window = {
      registrationClosesAt: new Date("2027-03-20T04:00:00Z"),
      startsOn: "2027-04-05",
    };
    expect(requestsOpen(window, new Date("2027-03-20T03:59:59Z"))).toBe(true);
    expect(requestsOpen(window, new Date("2027-03-20T04:00:00Z"))).toBe(false);
  });

  it("falls back to the season start without a registration close", () => {
    const window = { registrationClosesAt: null, startsOn: "2027-04-05" };
    expect(requestsOpen(window, new Date("2027-04-04T23:00:00Z"))).toBe(true);
    expect(requestsOpen(window, new Date("2027-04-05T00:00:00Z"))).toBe(false);
  });
});

describe("describeRequest", () => {
  const time = (i: number) => ["6:00 pm", "7:15 pm", "8:30 pm"][i] ?? "?";
  const date = (d: string) => (d === "2027-05-10" ? "Mon, May 10" : d);

  it.each([
    [
      { kind: "unavailable", onDate: "2027-05-10", timeIndex: null },
      "Can't play: Mon, May 10",
    ],
    [
      { kind: "prefer", onDate: null, timeIndex: 2 },
      "Would rather play: the 8:30 pm game",
    ],
    [
      { kind: "avoid", onDate: "2027-05-10", timeIndex: 0 },
      "Would rather not play: Mon, May 10, the 6:00 pm game",
    ],
  ] as const)("reads %j as %s", (request, text) => {
    expect(describeRequest(request, time, date)).toBe(text);
  });
});
