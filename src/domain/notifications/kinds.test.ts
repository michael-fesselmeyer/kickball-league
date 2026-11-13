import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIGEST_KIND,
  deliveryClassOf,
  eventNoticeKind,
  MESSAGE_KINDS,
  NON_URGENT_KINDS,
  URGENT_LABELS,
} from "./kinds";

describe("deliveryClassOf", () => {
  it("follows the table", () => {
    expect(deliveryClassOf("rainout_notice")).toBe("urgent");
    expect(deliveryClassOf("announcement")).toBe("non_urgent");
    expect(deliveryClassOf(DIGEST_KIND)).toBe("digest");
  });

  it("treats a kind it does not know as urgent, so nothing is held by mistake", () => {
    expect(deliveryClassOf("not_a_kind")).toBe("urgent");
    expect(deliveryClassOf("toString")).toBe("urgent");
  });
});

describe("MESSAGE_KINDS", () => {
  it("lists the non-urgent kinds and the urgent labels from one table", () => {
    expect([...NON_URGENT_KINDS].sort()).toEqual([
      "announcement",
      "books_reminder",
      "event_news",
      "giveaway_win",
      "instagram_reconnect",
      "instagram_storage_full",
      "new_team",
      "rebate_credit",
      "referral_credit",
      "score_reminder",
    ]);
    expect(URGENT_LABELS).toContain("Rain-outs and makeup times");
  });

  it("matches the table in docs/architecture.md, section 5", () => {
    const doc = readFileSync("docs/architecture.md", "utf8");
    const rows = [
      ...doc.matchAll(/^\| `([a-z_]+)` \| (urgent|non-urgent) \| (.+) \|$/gm),
    ].map(([, kind, urgency, label]) => [
      kind,
      urgency?.replace("-", "_"),
      label,
    ]);
    expect(rows).toEqual(
      Object.entries(MESSAGE_KINDS).map(([kind, k]) => [
        kind,
        k.urgency,
        k.label,
      ]),
    );
  });
});

describe("every message the code queues", () => {
  const SRC = join(__dirname, "..", "..");

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });
  }

  /** `template: "x"` wherever a message row is written, outside tests. */
  const named = sources(SRC).flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(/\btemplate: "([a-z_]+)"/g)].map(
      ([, name]) => [relative(SRC, path), name] as const,
    ),
  );

  it("finds the queued messages", () => {
    expect(named.length).toBeGreaterThan(10);
  });

  it.each(named)(
    "%s queues %s, a kind that says whether it is urgent",
    (_path, name) => {
      expect(
        name === DIGEST_KIND || Object.hasOwn(MESSAGE_KINDS, name ?? ""),
      ).toBe(true);
    },
  );
});

describe("eventNoticeKind", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

  it("always hurries a spot that opened for someone", () => {
    expect(
      eventNoticeKind({ notice: "spot_opened", startsAt: hours(500), now }),
    ).toBe("event_notice");
  });

  it("hurries a cancellation within a day of the start, not further out", () => {
    expect(
      eventNoticeKind({ notice: "cancelled", startsAt: hours(23), now }),
    ).toBe("event_notice");
    expect(
      eventNoticeKind({ notice: "cancelled", startsAt: hours(24), now }),
    ).toBe("event_notice");
    expect(
      eventNoticeKind({ notice: "cancelled", startsAt: hours(25), now }),
    ).toBe("event_news");
  });

  it("hurries only a change to the time or place within a day", () => {
    const soon = { notice: "updated" as const, startsAt: hours(3), now };
    expect(eventNoticeKind({ ...soon, timeOrPlaceChanged: true })).toBe(
      "event_notice",
    );
    expect(eventNoticeKind({ ...soon, timeOrPlaceChanged: false })).toBe(
      "event_news",
    );
    expect(
      eventNoticeKind({
        notice: "updated",
        startsAt: hours(72),
        timeOrPlaceChanged: true,
        now,
      }),
    ).toBe("event_news");
  });

  it("counts the old start when an event tonight moves to next week", () => {
    expect(
      eventNoticeKind({
        notice: "updated",
        startsAt: hours(170),
        startedBefore: hours(4),
        timeOrPlaceChanged: true,
        now,
      }),
    ).toBe("event_notice");
  });

  it("lets an announcement wait, however soon", () => {
    expect(
      eventNoticeKind({ notice: "announced", startsAt: hours(2), now }),
    ).toBe("event_news");
  });
});
