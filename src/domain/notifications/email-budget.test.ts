import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type EmailBudget,
  emailBudgetFrom,
  emailsLeft,
  FREE_EMAIL_BUDGET,
  isQuotaRefusal,
  nextUtcDay,
  startOfUtcDay,
  startOfUtcMonth,
  whenOutOfEmail,
} from "./email-budget";

const DAY = 24 * 60 * 60 * 1000;

describe("emailBudgetFrom", () => {
  it("defaults to the provider's free plan", () => {
    expect(emailBudgetFrom({})).toEqual(FREE_EMAIL_BUDGET);
    expect(FREE_EMAIL_BUDGET).toEqual({
      daily: 100,
      monthly: 3000,
      reserve: 10,
    });
  });

  it("reads the limits, ignoring anything that is not a whole number", () => {
    expect(
      emailBudgetFrom({
        EMAIL_DAILY_LIMIT: "200",
        EMAIL_MONTHLY_LIMIT: "6000",
        EMAIL_RESERVE: "5",
      }),
    ).toEqual({ daily: 200, monthly: 6000, reserve: 5 });
    expect(
      emailBudgetFrom({ EMAIL_DAILY_LIMIT: "lots", EMAIL_RESERVE: "-1" }),
    ).toEqual(FREE_EMAIL_BUDGET);
  });

  it("never lets the reserve take the whole day", () => {
    expect(
      emailBudgetFrom({ EMAIL_DAILY_LIMIT: "10", EMAIL_RESERVE: "50" }),
    ).toEqual({ daily: 10, monthly: 3000, reserve: 5 });
  });
});

describe("the provider's calendar", () => {
  it("counts days and months in UTC", () => {
    const at = new Date("2026-11-30T23:30:00Z");
    expect(startOfUtcDay(at).toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect(startOfUtcMonth(at).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextUtcDay(at).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("emailsLeft", () => {
  it("keeps the reserve back from ordinary messages", () => {
    const used = { today: 85, month: 400 };
    expect(emailsLeft(FREE_EMAIL_BUDGET, used, { reserve: false })).toBe(5);
    expect(emailsLeft(FREE_EMAIL_BUDGET, used, { reserve: true })).toBe(15);
  });

  it("stops at the month's limit too, and never goes below zero", () => {
    expect(
      emailsLeft(
        FREE_EMAIL_BUDGET,
        { today: 3, month: 2995 },
        { reserve: false },
      ),
    ).toBe(0);
    expect(
      emailsLeft(
        FREE_EMAIL_BUDGET,
        { today: 200, month: 200 },
        { reserve: true },
      ),
    ).toBe(0);
  });
});

describe("whenOutOfEmail", () => {
  it("counts a pushed urgent message as delivered, and saves the rest", () => {
    expect(whenOutOfEmail("urgent", { pushSent: true })).toBe("pushed");
    expect(whenOutOfEmail("urgent", { pushSent: false })).toBe("tomorrow");
    expect(whenOutOfEmail("non_urgent", { pushSent: true })).toBe("digest");
    expect(whenOutOfEmail("digest", { pushSent: false })).toBe("tomorrow");
  });
});

describe("isQuotaRefusal", () => {
  it("knows the provider's quota errors from other refusals", () => {
    expect(
      isQuotaRefusal("Resend refused the email (429 daily_quota_exceeded): x"),
    ).toBe(true);
    expect(
      isQuotaRefusal(
        "Resend refused the email (429 monthly_quota_exceeded): x",
      ),
    ).toBe(true);
    expect(
      isQuotaRefusal("Resend refused the email (429 rate_limit_exceeded): x"),
    ).toBe(false);
  });
});

/**
 * A model of the outbox's email side over many days: urgent messages
 * (some whose push copy reached the person) and news arrive, drains run at
 * random times and send in priority order while emails are left, and what
 * the quota cannot cover is pushed, waits for the next UTC day, or goes to
 * the digest. The provider's limits must never be passed, no urgent
 * message may be dropped, and every urgent one must get through once
 * arrivals stop and the quota returns.
 */
describe("the email budget over weeks", () => {
  type Item = {
    id: number;
    urgent: boolean;
    pushSent: boolean;
    dueAt: number;
    state: "queued" | "sent" | "pushed" | "digest";
  };

  const budgets: fc.Arbitrary<EmailBudget> = fc
    .record({
      daily: fc.integer({ min: 2, max: 30 }),
      monthly: fc.integer({ min: 10, max: 300 }),
      reserve: fc.integer({ min: 0, max: 3 }),
    })
    .map((b) =>
      emailBudgetFrom({
        EMAIL_DAILY_LIMIT: String(b.daily),
        EMAIL_MONTHLY_LIMIT: String(b.monthly),
        EMAIL_RESERVE: String(b.reserve),
      }),
    );

  const arrival = fc.record({
    minute: fc.integer({ min: 0, max: 20 * 24 * 60 }),
    urgent: fc.boolean(),
    pushSent: fc.boolean(),
    count: fc.integer({ min: 1, max: 40 }),
  });

  it("never passes the daily or monthly limit and never drops urgent email", () => {
    fc.assert(
      fc.property(
        budgets,
        fc.array(arrival, { maxLength: 15 }),
        fc.array(fc.integer({ min: 0, max: 20 * 24 * 60 }), {
          minLength: 1,
          maxLength: 40,
        }),
        (budget, arrivals, drainMinutes) => {
          const start = Date.parse("2026-11-20T00:00:00Z");
          const items: Item[] = [];
          for (const a of arrivals)
            for (let i = 0; i < a.count; i++)
              items.push({
                id: items.length,
                urgent: a.urgent,
                pushSent: a.pushSent,
                dueAt: start + a.minute * 60_000,
                state: "queued",
              });
          // Drains as the job and immediate sends run them, then one a day
          // for 70 days after arrivals stop, so a month boundary passes.
          const drains = [
            ...drainMinutes.map((m) => start + m * 60_000),
            ...Array.from(
              { length: 70 },
              (_, d) => start + (21 + d) * DAY + 13 * 3_600_000,
            ),
          ].sort((a, b) => a - b);
          const sentAt: number[] = [];
          for (const at of drains) {
            const now = new Date(at);
            const used = {
              today: sentAt.filter((t) => t >= startOfUtcDay(now).getTime())
                .length,
              month: sentAt.filter((t) => t >= startOfUtcMonth(now).getTime())
                .length,
            };
            const due = items
              .filter((i) => i.state === "queued" && i.dueAt <= at)
              .sort(
                (a, b) =>
                  (a.urgent ? 0 : 2) +
                  (a.pushSent ? 1 : 0) -
                  ((b.urgent ? 0 : 2) + (b.pushSent ? 1 : 0)),
              );
            for (const item of due) {
              if (emailsLeft(budget, used, { reserve: false }) > 0) {
                item.state = "sent";
                sentAt.push(at);
                used.today++;
                used.month++;
                continue;
              }
              const next = whenOutOfEmail(
                item.urgent ? "urgent" : "non_urgent",
                { pushSent: item.pushSent },
              );
              if (next === "pushed") item.state = "pushed";
              else if (next === "digest") item.state = "digest";
              else item.dueAt = nextUtcDay(now).getTime();
            }
          }
          // The limits, counted the provider's way, held on every day and
          // in every month.
          const perDay = new Map<number, number>();
          const perMonth = new Map<number, number>();
          for (const t of sentAt) {
            const d = startOfUtcDay(new Date(t)).getTime();
            const m = startOfUtcMonth(new Date(t)).getTime();
            perDay.set(d, (perDay.get(d) ?? 0) + 1);
            perMonth.set(m, (perMonth.get(m) ?? 0) + 1);
          }
          for (const n of perDay.values())
            expect(n).toBeLessThanOrEqual(budget.daily - budget.reserve);
          for (const n of perMonth.values())
            expect(n).toBeLessThanOrEqual(budget.monthly - budget.reserve);
          // Urgent email was never dropped: it was sent, the person's
          // phone had it, or it is still waiting for a later day. News that
          // missed out is in the digest.
          const last = drains.at(-1) ?? start;
          for (const item of items) {
            if (item.urgent) {
              expect(["sent", "pushed", "queued"]).toContain(item.state);
              if (item.state === "pushed") expect(item.pushSent).toBe(true);
              if (item.state === "queued")
                expect(item.dueAt).toBeGreaterThan(last);
            } else {
              expect(["sent", "digest"]).toContain(item.state);
            }
          }
          // When a month's quota can carry everything, everything urgent
          // got through once arrivals stopped.
          const capacity = Math.min(
            budget.monthly - budget.reserve,
            28 * (budget.daily - budget.reserve),
          );
          if (items.length <= capacity)
            for (const item of items.filter((i) => i.urgent))
              expect(item.state).not.toBe("queued");
        },
      ),
      { numRuns: 200 },
    );
  });
});
