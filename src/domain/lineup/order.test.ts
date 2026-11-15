import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  autoArrange,
  explainImpossible,
  explainPickup,
  explainRun,
  type Kicker,
  move,
  ordinal,
  pickupBreaks,
  reconcile,
  runBreaks,
  runsOverLimit,
  type Side,
  separateOrdersSide,
  explainSeparateOrders,
} from "./order";

/** Kickers from a pattern such as "WWM-N", where letters after "-" are pickups. */
function kickers(pattern: string): Kicker[] {
  const [regular = "", pickup = ""] = pattern.split("-");
  return [...regular, ...pickup].map((letter, i) => ({
    id: `k${i}`,
    name: `${letter}${i}`,
    side: letter === "W" ? "woman" : letter === "M" ? "man" : null,
    pickup: i >= regular.length,
  }));
}

const pattern = (order: readonly { side: Side }[]) =>
  order
    .map((k) => (k.side === "woman" ? "W" : k.side === "man" ? "M" : "N"))
    .join("");

const valid = (order: readonly Kicker[]) =>
  runBreaks(order).length === 0 && pickupBreaks(order).length === 0;

/** Whether any order with pickups last keeps to the rule, by trying them all. */
function anyValid(order: readonly Kicker[]): boolean {
  const regulars = order.filter((k) => !k.pickup);
  const pickups = order.filter((k) => k.pickup);
  const perms = <T>(items: readonly T[]): T[][] =>
    items.length <= 1
      ? [[...items]]
      : items.flatMap((item, i) =>
          perms([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
            item,
            ...rest,
          ]),
        );
  // Only the sides matter, so try distinct side patterns.
  const distinct = (items: readonly Kicker[]) => {
    const seen = new Set<string>();
    return perms(items).filter((p) => {
      const key = pattern(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return distinct(regulars).some((r) =>
    distinct(pickups).some((p) => valid([...r, ...p])),
  );
}

const side = fc.constantFrom<Side>("woman", "man", null);
const roster = (maxLength: number) =>
  fc
    .array(fc.record({ side, pickup: fc.boolean() }), { maxLength })
    .map((rows) => rows.map((r, i) => ({ id: `k${i}`, name: `P${i}`, ...r })));

describe("runBreaks", () => {
  it("allows two of a side in a row", () => {
    expect(runBreaks(kickers("WWMMWM"))).toEqual([]);
  });

  it("finds three of a side in a row", () => {
    expect(runBreaks(kickers("MWWWMMW"))).toEqual([
      { side: "woman", positions: [1, 2, 3], wraps: false },
    ]);
  });

  it("counts from the last kicker around to the first", () => {
    expect(runBreaks(kickers("WMMWW"))).toEqual([
      { side: "woman", positions: [3, 4, 0], wraps: true },
    ]);
  });

  it("reports a long run once", () => {
    expect(runBreaks(kickers("MWWWWMNM"))).toHaveLength(1);
  });

  it("flags no runs when one side has more than twice the other", () => {
    // The league then allows a separate order for each side.
    expect(runBreaks(kickers("MMMM"))).toEqual([]);
    expect(runBreaks(kickers("WWWWWMM"))).toEqual([]);
    expect(separateOrdersSide(kickers("WWWWWMM"))).toBe("woman");
    expect(separateOrdersSide(kickers("MMMMMMWNN"))).toBe("man");
    expect(runsOverLimit(kickers("MMMM"))).toHaveLength(1);
  });

  it("holds a team at exactly two to one to the rule", () => {
    expect(separateOrdersSide(kickers("WWWWMM"))).toBeNull();
    expect(runBreaks(kickers("WWWMWM"))).toHaveLength(1);
  });

  it("lets a player without a side break a run", () => {
    expect(runBreaks(kickers("WWNWWNMM"))).toEqual([]);
    expect(runBreaks(kickers("NNNN"))).toEqual([]);
  });

  it("has nothing to break with two kickers or fewer", () => {
    expect(runBreaks(kickers("WW"))).toEqual([]);
    expect(runBreaks([])).toEqual([]);
  });

  it("finds every window of three of a side, around the wrap too", () => {
    fc.assert(
      fc.property(roster(12), (order) => {
        const n = order.length;
        const flagged = new Set(runBreaks(order).flatMap((b) => b.positions));
        for (let i = 0; n > 2 && i < n; i += 1) {
          const window = [i, (i + 1) % n, (i + 2) % n].map(
            (p) => order[p]?.side,
          );
          const same =
            separateOrdersSide(order) === null &&
            window[0] !== null &&
            window.every((s) => s === window[0]);
          if (same) expect(flagged.has(i)).toBe(true);
        }
      }),
    );
  });
});

describe("pickupBreaks", () => {
  it("flags a pickup ahead of the team's own players", () => {
    const order = kickers("WM-W");
    expect(pickupBreaks(order)).toEqual([]);
    expect(pickupBreaks(move(order, 2, 0))).toEqual([{ position: 0 }]);
  });
});

describe("explanations", () => {
  it("explains the separate-orders exception", () => {
    expect(explainSeparateOrders("man")).toBe(
      "With more than two times as many men as women, the league lets the team keep two kicking orders, one for each side, instead of the two-in-a-row rule. Tell the ref and the other captain which way you're kicking.",
    );
  });

  it("names the kickers and the wrap", () => {
    const order = kickers("WMMWW");
    const [run] = runBreaks(order);
    expect(run && explainRun(run, order)).toBe(
      "W3, W4, and W0 make three women in a row counting from the last kicker back around to the first. The rule allows two: move someone from the other side between them.",
    );
  });

  it("explains a pickup out of place", () => {
    expect(explainPickup({ position: 0 }, [{ name: "Robin K." }])).toBe(
      "Robin K. is a pickup, and pickups kick after the team's own players.",
    );
  });

  it("says how many more players would make it work", () => {
    expect(
      explainImpossible({ reason: "too_many", side: "man", short: 1 }),
    ).toContain("One more woman");
    expect(
      explainImpossible({ reason: "too_many", side: "woman", short: 3 }),
    ).toContain("three more men");
  });
});

describe("autoArrange", () => {
  it("leaves an order that keeps to the rule alone", () => {
    const order = kickers("WWMWMM");
    expect(autoArrange(order)).toEqual({ ok: true, value: order });
  });

  it("splits up a run, moving as little as it can", () => {
    const result = autoArrange(kickers("WWWMMM"));
    expect(result.ok && pattern(result.value)).toBe("WWMWMM");
  });

  it("keeps pickups last", () => {
    const result = autoArrange(kickers("WWWMM-M"));
    expect(result.ok && result.value.map((k) => k.pickup)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(result.ok && valid(result.value)).toBe(true);
  });

  it("leaves the order as it is when a side too big to split may kick on its own", () => {
    const order = kickers("WWWWWWWMM-M");
    const result = autoArrange(move(order, 9, 0));
    expect(result.ok && result.value.map((k) => k.id)).toEqual(
      order.map((k) => k.id),
    );
    expect(autoArrange(kickers("MMM"))).toEqual({
      ok: true,
      value: kickers("MMM"),
    });
  });

  it("still keeps to the rule when it can, even with separate orders allowed", () => {
    const result = autoArrange(kickers("WWWWNN"));
    expect(result.ok && pattern(result.value)).toBe("WWNWWN");
  });

  it("counts players without a side as splitting a run", () => {
    const result = autoArrange(kickers("WWWWNN"));
    expect(result.ok && pattern(result.value)).toBe("WWNWWN");
  });

  it("says when pickups kicking last is what makes it impossible", () => {
    expect(autoArrange(kickers("WWW-MMM"))).toEqual({
      ok: false,
      error: { reason: "pickups_last" },
    });
  });

  it("finds a valid order whenever one exists, and only then", () => {
    fc.assert(
      fc.property(roster(7), (order) => {
        const result = autoArrange(order);
        expect(result.ok).toBe(anyValid(order));
      }),
    );
  });

  it("gives an order with no three of a side in a row, around the wrap", () => {
    fc.assert(
      fc.property(roster(16), (order) => {
        const result = autoArrange(order);
        if (!result.ok) return;
        expect(valid(result.value)).toBe(true);
        expect([...result.value].map((k) => k.id).sort()).toEqual(
          order.map((k) => k.id).sort(),
        );
      }),
    );
  });

  it("is stable: arranging an arranged order changes nothing", () => {
    fc.assert(
      fc.property(roster(16), (order) => {
        const once = autoArrange(order);
        if (!once.ok) return;
        expect(autoArrange(once.value)).toEqual(once);
      }),
    );
  });

  it("keeps each side's kickers in their order", () => {
    fc.assert(
      fc.property(roster(16), (order) => {
        const result = autoArrange(order);
        if (!result.ok) return;
        for (const s of ["woman", "man", null] as const)
          for (const pickup of [false, true]) {
            const ids = (list: readonly Kicker[]) =>
              list
                .filter((k) => k.side === s && k.pickup === pickup)
                .map((k) => k.id);
            expect(ids(result.value)).toEqual(ids(order));
          }
      }),
    );
  });

  it("handles a full roster quickly", () => {
    const big = kickers(`${"WM".repeat(12)}-WMN`);
    const started = performance.now();
    expect(autoArrange([...big].reverse()).ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("reconcile", () => {
  it("drops who is out, adds who is new and puts pickups last", () => {
    const available = kickers("WMW-M");
    const result = reconcile<string, Kicker>(
      ["k3", "gone", "k2", "k0"],
      available,
    );
    expect(result.order.map((k) => k.id)).toEqual(["k2", "k0", "k1", "k3"]);
    expect(result.dropped).toEqual(["gone"]);
    expect(result.added.map((k) => k.id)).toEqual(["k1"]);
  });
});

describe("move", () => {
  it("moves a kicker and shifts the rest", () => {
    expect(move(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(move(["a", "b"], 0, 9)).toEqual(["b", "a"]);
    expect(move(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("ordinal", () => {
  it("writes places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "103rd",
    ]);
  });
});
