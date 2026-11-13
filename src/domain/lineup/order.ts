/**
 * The kicking order (rulebook 2.2.4, quoted in docs/product-spec.md,
 * section 2): no more than 2 players of the same gender kick in a row, and
 * the order wraps, so the last kicker and the first count as neighbours.
 * Pickups, players borrowed from outside the roster, kick last (rulebook
 * 2.1.4).
 *
 * A player counts toward the side they chose in their profile (their lineup
 * gender). A player who has not chosen counts toward neither side: they
 * never make a run and they break one (ADR 0030). The site warns; it never
 * blocks a game (product-spec.md, section 7).
 */
import { err, ok, type Result } from "../result";

/** The side a player counts toward, or null when they have not chosen. */
export type Side = "woman" | "man" | null;

export type Kicker<Id extends string = string> = {
  id: Id;
  /** First name and last initial. */
  name: string;
  side: Side;
  /** Picked up from outside the roster, so kicks last. */
  pickup: boolean;
};

/** The league's limit: at most this many of one side in a row. */
export const MAX_IN_A_ROW = 2;

/** A run of one side longer than the limit. */
export type RunBreak = {
  side: "woman" | "man";
  /** 0-based positions in kicking order, in the order they kick. */
  positions: number[];
  /** The run goes from the last kicker around to the first. */
  wraps: boolean;
};

/** A pickup who kicks before one of the team's own players. */
export type PickupBreak = { position: number };

/**
 * Every run of one side longer than `max`, counted around the wrap. A run is
 * reported once, however long. With `max` players or fewer there is no run
 * to break.
 */
export function runBreaks(
  order: readonly { side: Side }[],
  max: number = MAX_IN_A_ROW,
): RunBreak[] {
  const n = order.length;
  if (n <= max) return [];
  const sideAt = (i: number) => order[((i % n) + n) % n]?.side ?? null;
  const first = sideAt(0);
  if (order.every((k) => k.side === first))
    return first === null
      ? []
      : [{ side: first, positions: order.map((_, i) => i), wraps: false }];
  // Start just after a change of side, so no run is split by the wrap.
  let start = 0;
  while (sideAt(start) === sideAt(start - 1)) start += 1;
  const breaks: RunBreak[] = [];
  let i = 0;
  while (i < n) {
    const side = sideAt(start + i);
    let length = 1;
    while (i + length < n && sideAt(start + i + length) === side) length += 1;
    if (side !== null && length > max) {
      const positions = Array.from({ length }, (_, j) => (start + i + j) % n);
      breaks.push({
        side,
        positions,
        wraps: positions.some((p, j) => j > 0 && p < (positions[j - 1] ?? 0)),
      });
    }
    i += length;
  }
  return breaks.sort((a, b) => (a.positions[0] ?? 0) - (b.positions[0] ?? 0));
}

/** Pickups placed before one of the team's own players. */
export function pickupBreaks(
  order: readonly { pickup: boolean }[],
): PickupBreak[] {
  const lastRegular = order.findLastIndex((k) => !k.pickup);
  return order.flatMap((k, position) =>
    k.pickup && position < lastRegular ? [{ position }] : [],
  );
}

const NUMBER = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const count = (n: number) => NUMBER[n] ?? String(n);
const PLURAL = { woman: "women", man: "men" } as const;
const list = (names: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(names);

/** One rule break in plain words, naming the kickers. */
export function explainRun(
  run: RunBreak,
  order: readonly { name: string }[],
  max: number = MAX_IN_A_ROW,
): string {
  const names = run.positions.map((p) => order[p]?.name ?? "");
  const around = run.wraps
    ? " counting from the last kicker back around to the first"
    : "";
  return `${list(names)} make ${count(run.positions.length)} ${PLURAL[run.side]} in a row${around}. The rule allows ${count(max)}: move someone from the other side between them.`;
}

export function explainPickup(
  found: PickupBreak,
  order: readonly { name: string }[],
): string {
  const name = order[found.position]?.name ?? "A pickup";
  return `${name} is a pickup, and pickups kick after the team's own players.`;
}

/** Why no order can keep to the rule. */
export type Impossible =
  | { reason: "too_many"; side: "woman" | "man"; short: number }
  | { reason: "pickups_last" };

export function explainImpossible(
  why: Impossible,
  max: number = MAX_IN_A_ROW,
): string {
  if (why.reason === "pickups_last")
    return "No order works with the pickups kicking last. Arrange it by hand and check with the ref.";
  const other = why.side === "woman" ? "man" : "woman";
  return `There are too many ${PLURAL[why.side]} to split up: every ${count(max)} ${PLURAL[why.side]} need someone else after them before the next. ${why.short === 1 ? `One more ${other}` : `${count(why.short)} more ${PLURAL[other]}`} (or players who haven't chosen a side) would make it work. Until then, check with the ref.`;
}

type Label = "W" | "M" | "N";
const labelOf = (side: Side): Label =>
  side === "woman" ? "W" : side === "man" ? "M" : "N";

type Counts = { W: number; M: number; N: number };
const countsOf = (kickers: readonly { side: Side }[]): Counts => {
  const counts = { W: 0, M: 0, N: 0 };
  for (const k of kickers) counts[labelOf(k.side)] += 1;
  return counts;
};

/**
 * Whether the counts allow any order, ignoring pickups: in a circle, each
 * side's players split into runs of at most `max`, and every run needs
 * someone from outside the side after it.
 */
function tooMany(counts: Counts, max: number): Impossible | null {
  const total = counts.W + counts.M + counts.N;
  if (total <= max) return null;
  for (const [label, side] of [
    ["W", "woman"],
    ["M", "man"],
  ] as const) {
    const others = total - counts[label];
    const needed = Math.ceil(counts[label] / max);
    if (needed > others)
      return { reason: "too_many", side, short: needed - others };
  }
  return null;
}

/** Where a partly built order stands, as far as the rule cares. */
type State = {
  regular: Counts;
  pickup: Counts;
  placed: number;
  /** The run at the end so far. */
  tail: { label: Label; length: number } | null;
  /** The run at the start; open while nobody else has followed it. */
  head: { label: Label; length: number; open: boolean } | null;
};

function place(state: State, label: Label, max: number): State | null {
  const fromRegular = state.regular.W + state.regular.M + state.regular.N > 0;
  const pool = fromRegular ? state.regular : state.pickup;
  if (pool[label] === 0) return null;
  const tail =
    state.tail?.label === label
      ? { label, length: state.tail.length + 1 }
      : { label, length: 1 };
  if (label !== "N" && tail.length > max) return null;
  const head =
    state.head === null
      ? { label, length: 1, open: true }
      : state.head.open && state.head.label === label
        ? { ...state.head, length: state.head.length + 1 }
        : { ...state.head, open: false };
  const next = { ...pool, [label]: pool[label] - 1 };
  return {
    regular: fromRegular ? next : state.regular,
    pickup: fromRegular ? state.pickup : next,
    placed: state.placed + 1,
    tail,
    head,
  };
}

/** Whether the finished order also keeps to the rule across the wrap. */
function closes(state: State, max: number): boolean {
  if (state.placed <= max || state.head === null || state.tail === null)
    return true;
  if (state.head.open || state.head.label !== state.tail.label) return true;
  return (
    state.head.label === "N" || state.head.length + state.tail.length <= max
  );
}

const keyOf = (s: State) =>
  [
    s.regular.W,
    s.regular.M,
    s.regular.N,
    s.pickup.W,
    s.pickup.M,
    s.pickup.N,
    s.tail?.label,
    s.tail?.length,
    s.head?.label,
    s.head?.length,
    s.head?.open,
  ].join(",");

/** Whether the rest of the order can still be finished within the rule. */
function finisher(max: number) {
  const memo = new Map<string, boolean>();
  const canFinish = (state: State): boolean => {
    const left =
      state.regular.W +
      state.regular.M +
      state.regular.N +
      state.pickup.W +
      state.pickup.M +
      state.pickup.N;
    if (left === 0) return closes(state, max);
    const key = keyOf(state);
    const known = memo.get(key);
    if (known !== undefined) return known;
    const result = (["W", "M", "N"] as const).some((label) => {
      const next = place(state, label, max);
      return next !== null && canFinish(next);
    });
    memo.set(key, result);
    return result;
  };
  return canFinish;
}

/**
 * An order that keeps to the rule, with pickups last, changing as little as
 * it can: at each spot it takes the earliest remaining kicker from the
 * current order who still lets the rest be finished. An order that already
 * keeps to the rule comes back unchanged.
 */
export function autoArrange<K extends { side: Side; pickup: boolean }>(
  order: readonly K[],
  max: number = MAX_IN_A_ROW,
): Result<K[], Impossible> {
  const crowded = tooMany(countsOf(order), max);
  if (crowded) return err(crowded);
  const regulars = order.filter((k) => !k.pickup);
  const pickups = order.filter((k) => k.pickup);
  const canFinish = finisher(max);
  // With too few kickers to make a run, any order with pickups last works.
  let state: State = {
    regular: countsOf(regulars),
    pickup: countsOf(pickups),
    placed: 0,
    tail: null,
    head: null,
  };
  if (order.length > max && !canFinish(state))
    return err({ reason: "pickups_last" });
  const result: K[] = [];
  for (const segment of [regulars, pickups]) {
    const left = [...segment];
    while (left.length > 0) {
      const at = left.findIndex((k) => {
        const next = place(state, labelOf(k.side), max);
        return next !== null && (order.length <= max || canFinish(next));
      });
      // canFinish(state) held, so some kicker fits; fall back defensively.
      const index = Math.max(at, 0);
      const [kicker] = left.splice(index, 1);
      if (!kicker) break;
      state = place(state, labelOf(kicker.side), max) ?? state;
      result.push(kicker);
    }
  }
  return ok(result);
}

/**
 * Brings a saved order up to date with who is coming: kickers no longer
 * available drop out, new ones join at the end in the order given, and
 * pickups move after the team's own players.
 */
export function reconcile<
  Id extends string,
  K extends { id: Id; pickup: boolean },
>(
  saved: readonly Id[],
  available: readonly K[],
): { order: K[]; dropped: Id[]; added: K[] } {
  const byId = new Map(available.map((k) => [k.id, k]));
  const kept = saved.flatMap((id) => {
    const k = byId.get(id);
    return k ? [k] : [];
  });
  const keptIds = new Set(kept.map((k) => k.id));
  const added = available.filter((k) => !keptIds.has(k.id));
  const all = [...kept, ...added];
  return {
    order: [...all.filter((k) => !k.pickup), ...all.filter((k) => k.pickup)],
    dropped: saved.filter((id) => !byId.has(id)),
    added,
  };
}

/** Moves the kicker at `from` to `to`, shifting the others. */
export function move<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(Math.min(Math.max(to, 0), next.length), 0, item);
  return next;
}

/** "1st", "2nd", "3rd", "11th"… */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}
