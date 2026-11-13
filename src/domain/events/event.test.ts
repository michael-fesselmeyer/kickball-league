import { describe, expect, it } from "vitest";
import {
  type EventForm,
  eventFormValues,
  eventSlug,
  MAX_THEME_DAYS,
  nextDay,
  parseEventForm,
  placeFor,
  promotions,
  rsvpWindow,
  spotsLeft,
  themeFor,
  themeWeekDays,
  whenLine,
} from "./event";

const NY = "America/New_York";

const barNight: EventForm = {
  kind: "bar_night",
  title: "  Wrap party ",
  place: "The Example Tavern, 1 Example St",
  description: "Awards.\r\n\r\nSnacks.",
  capacity: "40",
  startsOn: "2026-10-31",
  startTime: "20:00",
  endsOn: "",
  endTime: "23:00",
};

const themeWeek: EventForm = {
  kind: "theme_week",
  title: "Costume week",
  place: "",
  description: "",
  capacity: "30",
  startsOn: "2026-10-26",
  startTime: "",
  endsOn: "2026-11-01",
  endTime: "",
};

describe("parseEventForm", () => {
  it("reads a timed event in the league's time zone", () => {
    const parsed = parseEventForm(barNight, NY);
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: "bar_night",
        title: "Wrap party",
        place: "The Example Tavern, 1 Example St",
        description: "Awards.\n\nSnacks.",
        capacity: 40,
        startsAt: new Date("2026-11-01T00:00:00Z"),
        endsAt: new Date("2026-11-01T03:00:00Z"),
      },
    });
  });

  it("runs an end time before the start time past midnight", () => {
    const parsed = parseEventForm(
      { ...barNight, startTime: "22:00", endTime: "01:00" },
      NY,
    );
    // 1 am comes twice as clocks fall back that night; the first is EDT.
    expect(parsed.ok && parsed.value.endsAt).toEqual(
      new Date("2026-11-01T05:00:00Z"),
    );
  });

  it("takes an end date for an event over several days", () => {
    const parsed = parseEventForm(
      { ...barNight, endsOn: "2026-11-01", endTime: "18:00" },
      NY,
    );
    // Clocks fall back on November 1: 6 pm is EST.
    expect(parsed.ok && parsed.value.endsAt).toEqual(
      new Date("2026-11-01T23:00:00Z"),
    );
  });

  it("covers whole days for a theme week and ignores its capacity", () => {
    const parsed = parseEventForm(themeWeek, NY);
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: "theme_week",
        title: "Costume week",
        place: null,
        description: "",
        capacity: null,
        startsAt: new Date("2026-10-26T04:00:00Z"),
        endsAt: new Date("2026-11-02T05:00:00Z"),
      },
    });
  });

  it("makes a one-day theme week when no last day is given", () => {
    const parsed = parseEventForm({ ...themeWeek, endsOn: "" }, NY);
    expect(parsed.ok && parsed.value.endsAt).toEqual(
      new Date("2026-10-27T04:00:00Z"),
    );
  });

  it.each([
    [{ kind: "rave" }, "kind"],
    [{ title: " " }, "title"],
    [{ title: "x".repeat(81) }, "title"],
    [{ place: "" }, "place"],
    [{ description: "x".repeat(4001) }, "description"],
    [{ startsOn: "2026-02-30" }, "date"],
    [{ startsOn: "" }, "date"],
    [{ endsOn: "soon" }, "date"],
    [{ startTime: "8pm" }, "time"],
    [{ endTime: "" }, "time"],
    [{ endsOn: "2026-10-31", endTime: "19:00" }, "order"],
    [{ capacity: "0" }, "capacity"],
    [{ capacity: "2.5" }, "capacity"],
    [{ capacity: "5001" }, "capacity"],
  ] as const)("refuses %j (%s)", (change, error) => {
    expect(parseEventForm({ ...barNight, ...change }, NY)).toEqual({
      ok: false,
      error,
    });
  });

  it("refuses a theme week that ends before it starts or runs too long", () => {
    expect(parseEventForm({ ...themeWeek, endsOn: "2026-10-25" }, NY)).toEqual({
      ok: false,
      error: "order",
    });
    expect(
      parseEventForm(
        { ...themeWeek, endsOn: nthDay("2026-10-26", MAX_THEME_DAYS) },
        NY,
      ),
    ).toEqual({ ok: false, error: "too_long" });
    expect(
      parseEventForm(
        { ...themeWeek, endsOn: nthDay("2026-10-26", MAX_THEME_DAYS - 1) },
        NY,
      ).ok,
    ).toBe(true);
  });
});

function nthDay(from: string, n: number): string {
  let day = from;
  for (let i = 0; i < n; i += 1) day = nextDay(day);
  return day;
}

describe("eventFormValues", () => {
  it("fills the form back in with what was typed", () => {
    for (const form of [
      barNight,
      { ...barNight, startTime: "22:00", endTime: "01:00" },
      { ...barNight, endsOn: "2026-11-02", endTime: "18:00" },
      themeWeek,
    ]) {
      const parsed = parseEventForm(form, NY);
      if (!parsed.ok) throw new Error(parsed.error);
      const again = parseEventForm(eventFormValues(parsed.value, NY), NY);
      expect(again).toEqual(parsed);
    }
  });
});

describe("theme weeks", () => {
  const stored = {
    startsAt: new Date("2026-10-26T04:00:00Z"),
    endsAt: new Date("2026-11-02T05:00:00Z"),
  };

  it("know their first and last day in the league's time zone", () => {
    expect(themeWeekDays(stored, NY)).toEqual({
      first: "2026-10-26",
      last: "2026-11-01",
    });
  });

  it("mark the game days inside them", () => {
    const weeks = [
      { title: "Costume week", slug: "costume", ...themeWeekDays(stored, NY) },
    ];
    expect(themeFor("2026-10-25", weeks)).toBeNull();
    expect(themeFor("2026-10-26", weeks)?.title).toBe("Costume week");
    expect(themeFor("2026-11-01", weeks)?.title).toBe("Costume week");
    expect(themeFor("2026-11-02", weeks)).toBeNull();
  });
});

describe("spots and the waitlist", () => {
  it("gives a spot while there is one and nobody is waiting", () => {
    expect(placeFor(null, 500, 0)).toBe("going");
    expect(placeFor(10, 9, 0)).toBe("going");
    expect(placeFor(10, 10, 0)).toBe("waitlisted");
    // A spot that opened while people wait is theirs, not a newcomer's.
    expect(placeFor(10, 9, 2)).toBe("waitlisted");
  });

  it("moves up as many people as there are open spots", () => {
    expect(promotions(10, 9, 3)).toBe(1);
    expect(promotions(10, 5, 3)).toBe(3);
    expect(promotions(10, 10, 3)).toBe(0);
    // A smaller capacity never bumps anyone.
    expect(promotions(5, 8, 3)).toBe(0);
    expect(promotions(null, 8, 3)).toBe(3);
  });

  it("counts spots left", () => {
    expect(spotsLeft(null, 4)).toBeNull();
    expect(spotsLeft(12, 4)).toBe(8);
    expect(spotsLeft(12, 15)).toBe(0);
  });
});

describe("rsvpWindow", () => {
  const e = {
    kind: "bbq" as const,
    endsAt: new Date("2027-04-10T20:00:00Z"),
    cancelledAt: null,
  };
  it("is open until the event ends", () => {
    expect(rsvpWindow(e, new Date("2027-04-10T19:59:00Z"))).toBe("open");
    expect(rsvpWindow(e, new Date("2027-04-10T20:00:00Z"))).toBe("over");
  });
  it("is shut for a called-off event and for theme weeks", () => {
    expect(
      rsvpWindow({ ...e, cancelledAt: new Date() }, new Date("2027-01-01")),
    ).toBe("cancelled");
    expect(
      rsvpWindow({ ...e, kind: "theme_week" }, new Date("2027-01-01")),
    ).toBe("no_rsvp");
  });
});

describe("whenLine", () => {
  it("reads a night out, one past midnight, and a theme week", () => {
    const night = parseEventForm(barNight, NY);
    const late = parseEventForm(
      { ...barNight, startTime: "22:00", endTime: "01:00" },
      NY,
    );
    const week = parseEventForm(themeWeek, NY);
    if (!night.ok || !late.ok || !week.ok) throw new Error("bad fixture");
    expect(whenLine(night.value, NY)).toBe("Sat, Oct 31, 8:00 PM – 11:00 PM");
    expect(whenLine(late.value, NY)).toBe("Sat, Oct 31, 10:00 PM – 1:00 AM");
    expect(whenLine(week.value, NY)).toBe("Mon, Oct 26 – Sun, Nov 1");
  });

  it("names both days for an event that runs longer", () => {
    const long = parseEventForm(
      {
        ...barNight,
        startTime: "10:00",
        endsOn: "2026-11-01",
        endTime: "18:00",
      },
      NY,
    );
    if (!long.ok) throw new Error("bad fixture");
    expect(whenLine(long.value, NY)).toBe(
      "Sat, Oct 31, 10:00 AM – Sun, Nov 1, 6:00 PM",
    );
  });
});

describe("eventSlug", () => {
  it("joins the title and the local start date", () => {
    expect(
      eventSlug("Spring Kickoff BBQ!", new Date("2027-04-10T16:00:00Z"), NY),
    ).toBe("spring-kickoff-bbq-2027-04-10");
    // 11 pm in New York is the next day in UTC.
    expect(eventSlug("Late", new Date("2027-04-11T03:00:00Z"), NY)).toBe(
      "late-2027-04-10",
    );
    expect(eventSlug("🎉", new Date("2027-04-10T16:00:00Z"), NY)).toBe(
      "event-2027-04-10",
    );
  });
});
