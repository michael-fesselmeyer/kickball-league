import { describe, expect, it } from "vitest";
import {
  ACTING_POWER_ACTIONS,
  ACTING_POWERS,
  type ActingPower,
  checkGrant,
  MAX_GRANT_DAYS,
  powersAt,
} from "./acting-admin";
import {
  ACTIONS,
  type Action,
  can,
  type Context,
  VISITOR,
} from "./permissions";

const player = (acting?: readonly ActingPower[], leagueId = "kickball") => ({
  ...VISITOR,
  userId: "p",
  leagueId,
  globalRole: "player" as const,
  ...(acting ? { acting } : {}),
});
const admin = { ...player(), globalRole: "admin" as const };

/** Rich enough that an admin's rule can pass for every action. */
const context: Context = {
  leagueId: "kickball",
  teamSeasonId: "A",
  targetRole: "player",
  targetUserId: "someone-else",
  game: { id: "g1", teamSeasonIds: ["A", "B"], hasReferee: false },
  scope: "league",
  adminsConfirmRainouts: false,
};

const listed = (action: Action): ActingPower[] =>
  ACTING_POWERS.filter((p) =>
    (ACTING_POWER_ACTIONS[p] as readonly string[]).includes(action),
  );

describe("acting admin powers in the permissions matrix", () => {
  it("lists only actions the matrix has", () => {
    for (const p of ACTING_POWERS)
      for (const a of ACTING_POWER_ACTIONS[p])
        expect(ACTIONS, `${p} lists ${a}`).toContain(a);
  });

  it("gives an acting admin no action beyond their own rights and the powers' lists", () => {
    const all = player(ACTING_POWERS);
    const plain = player();
    for (const action of ACTIONS) {
      const expected =
        can(plain, action, context) ||
        (listed(action).length > 0 &&
          (can(admin, action, context) || action === "rainout.confirm"));
      expect(can(all, action, context), action).toBe(expected);
    }
  });

  for (const power of ACTING_POWERS) {
    describe(`the ${power} power`, () => {
      it("opens exactly its actions, as an admin could", () => {
        const holder = player([power]);
        const plain = player();
        for (const action of ACTIONS) {
          const opens = (
            ACTING_POWER_ACTIONS[power] as readonly string[]
          ).includes(action);
          const expected =
            can(plain, action, context) ||
            (opens &&
              (can(admin, action, context) ||
                (action === "rainout.confirm" && power === "rainouts")));
          expect(can(holder, action, context), action).toBe(expected);
        }
      });

      it("is needed for its actions: the other powers do not open them", () => {
        const holder = player(ACTING_POWERS.filter((p) => p !== power));
        for (const action of ACTING_POWER_ACTIONS[power]) {
          if (listed(action).some((p) => p !== power)) continue;
          expect(
            can(holder, action, context),
            `${action} without ${power}`,
          ).toBe(can(player(), action, context));
        }
      });
    });
  }

  it("never reaches money, roles, exports, the audit log or private lists", () => {
    const all = player(ACTING_POWERS);
    for (const action of [
      "refund.issue",
      "payment.record_offline",
      "payments.export",
      "roster.export",
      "accounts.merge",
      "audit.read",
      "admins.manage",
      "billing.manage",
      "books.manage",
      "dashboard.view",
      "money_summary.publish",
      "keep_off.review",
      "survey.results",
      "sportsmanship.view",
      "concern.review",
      "rainout.confirm_policy",
      "data.export_or_delete",
      "demo.manage",
      "permit.view_at_field",
    ] as const)
      expect(can(all, action, context), action).toBe(false);
  });

  it("gives nothing without powers", () => {
    expect(can(player([]), "game_day.status", context)).toBe(false);
    expect(can(player(undefined), "score.override", context)).toBe(false);
  });

  it("gives nothing to a visitor or in another league", () => {
    expect(
      can({ ...VISITOR, acting: ACTING_POWERS }, "score.override", context),
    ).toBe(false);
    expect(can(player(ACTING_POWERS, "other"), "score.override", context)).toBe(
      false,
    );
    expect(
      can(player(ACTING_POWERS), "score.override", {
        ...context,
        leagueId: "other",
      }),
    ).toBe(false);
  });
});

describe("powersAt", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 10, n));
  const grant = (
    powers: string[],
    from: number,
    to: number,
    endedAt: Date | null = null,
  ) => ({ powers, startsAt: day(from), endsAt: day(to), endedAt });

  it("gives powers from the start up to, not including, the end", () => {
    const g = [grant(["scores"], 10, 12)];
    expect(powersAt(g, day(9))).toEqual([]);
    expect(powersAt(g, day(10))).toEqual(["scores"]);
    expect(powersAt(g, new Date(day(12).getTime() - 1))).toEqual(["scores"]);
    expect(powersAt(g, day(12))).toEqual([]);
  });

  it("adds up overlapping handovers and drops each at its own end", () => {
    const g = [grant(["scores"], 10, 14), grant(["schedule"], 12, 16)];
    expect(powersAt(g, day(11))).toEqual(["scores"]);
    expect(powersAt(g, day(13))).toEqual(["scores", "schedule"]);
    expect(powersAt(g, day(15))).toEqual(["schedule"]);
  });

  it("stops at once when an owner ends one, keeping the other", () => {
    const g = [grant(["scores"], 10, 20, day(13)), grant(["rainouts"], 10, 20)];
    expect(powersAt(g, day(12))).toEqual(["scores", "rainouts"]);
    expect(powersAt(g, day(13))).toEqual(["rainouts"]);
  });

  it("ignores a power name it does not know", () => {
    expect(powersAt([grant(["owner", "scores"], 10, 12)], day(11))).toEqual([
      "scores",
    ]);
  });
});

describe("checkGrant", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const ok = {
    powers: ["scores"],
    startsAt: new Date("2026-11-11T00:00:00Z"),
    endsAt: new Date("2026-11-14T00:00:00Z"),
  };

  it("accepts a normal handover", () => {
    expect(checkGrant(ok, now)).toBeNull();
  });
  it("needs known powers", () => {
    expect(checkGrant({ ...ok, powers: [] }, now)).toBe("no_powers");
    expect(checkGrant({ ...ok, powers: ["admin"] }, now)).toBe("no_powers");
    expect(checkGrant({ ...ok, powers: ["scores", "owner"] }, now)).toBe(
      "no_powers",
    );
  });
  it("needs an end after the start, and not already past", () => {
    expect(checkGrant({ ...ok, endsAt: ok.startsAt }, now)).toBe("bad_dates");
    expect(
      checkGrant({ ...ok, startsAt: new Date("x"), endsAt: ok.endsAt }, now),
    ).toBe("bad_dates");
    expect(
      checkGrant(
        {
          ...ok,
          startsAt: new Date("2026-11-01T00:00:00Z"),
          endsAt: new Date("2026-11-05T00:00:00Z"),
        },
        now,
      ),
    ).toBe("in_the_past");
  });
  it("caps the length", () => {
    const endsAt = new Date(
      ok.startsAt.getTime() + (MAX_GRANT_DAYS + 1) * 864e5,
    );
    expect(checkGrant({ ...ok, endsAt }, now)).toBe("too_long");
  });
});
