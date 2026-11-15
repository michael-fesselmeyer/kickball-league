import { localDate } from "../books/ledger-csv";
import type { ParkField, Point } from "../capacity/nearby";
import { localTime } from "../time/zoned";
import {
  estimateWindow,
  type FeeEstimate,
  type FieldGuess,
  guessField,
  sumEstimates,
} from "./fees";
import { type GiveBack, officeFor, type UnusedReason } from "./give-back";
import { hoursLevel, type HoursLevel, permittedMinutes } from "./hours";
import { NEW_YORK, sunset } from "./sun";

/**
 * A season's permits as the owners plan around them (ADR 0055): the fee
 * each permit should cost, the season's hours against NYC Parks' 50-hour
 * insurance line, and the field time coming up that the league won't use.
 * Pure: the query (src/db/queries/permit-plan.ts) reads the rows, and the
 * permits screen, the books and the daily job all work from this.
 */

export type PlanWindow = {
  id: string;
  /** The permit it belongs to: the screen's group key. */
  group: string;
  fieldId: string;
  fieldName: string;
  venueName: string;
  venue: Point | null;
  startsAt: Date;
  endsAt: Date;
  status: "requested" | "confirmed" | "lost";
  permitNumber: string | null;
  costCents: number | null;
  /** Slots cut from the window, and how many of them are cancelled. */
  slots: number;
  cancelledSlots: number;
};

export type GroupFee = FieldGuess & {
  estimate: FeeEstimate;
  /** The owners entered the real cost, so the estimate isn't used. */
  costEntered: boolean;
};

export type UnusedWindow = GiveBack & {
  windowId: string;
  office: { name: string; phone: string } | null;
};

export type PermitPlan = {
  fees: Map<string, GroupFee>;
  /** Sum of the estimates for permits with no cost entered yet. */
  expectedCents: number;
  minutes: number;
  level: HoursLevel;
  unused: UnusedWindow[];
};

export function permitPlan(input: {
  windows: readonly PlanWindow[];
  /** League-wide blackout dates, and `date/fieldId` for one field. */
  blackouts: ReadonlySet<string>;
  parkFields: readonly ParkField[];
  timeZone: string;
  now: Date;
  /** The league's name, which holds the permits. */
  holder: string;
}): PermitPlan {
  const { windows, timeZone } = input;
  const guesses = new Map<string, FieldGuess>();
  const guessFor = (w: PlanWindow) => {
    const known = guesses.get(w.fieldId);
    if (known) return known;
    const guess = guessField(input.parkFields, w.venue, w.fieldName);
    guesses.set(w.fieldId, guess);
    return guess;
  };

  const byGroup = new Map<string, PlanWindow[]>();
  for (const w of windows)
    if (w.status !== "lost")
      byGroup.set(w.group, [...(byGroup.get(w.group) ?? []), w]);
  const fees = new Map<string, GroupFee>();
  let expectedCents = 0;
  for (const [group, rows] of byGroup) {
    const first = rows[0];
    if (!first) continue;
    const guess = guessFor(first);
    const estimate = sumEstimates(
      rows.map((w) =>
        estimateWindow(
          w,
          guess.surface,
          sunset(localDate(w.startsAt, timeZone), w.venue ?? NEW_YORK),
        ),
      ),
    );
    const costEntered = rows.some((w) => w.costCents !== null);
    if (!costEntered) expectedCents += estimate.cents;
    fees.set(group, { ...guess, estimate, costEntered });
  }

  const minutes = permittedMinutes(windows);
  const unused = windows.flatMap((w): UnusedWindow[] => {
    if (w.status === "lost") return [];
    // Only time not yet started can still go to someone else.
    if (w.startsAt.getTime() <= input.now.getTime()) return [];
    const on = localDate(w.startsAt, timeZone);
    const reason: UnusedReason | null =
      input.blackouts.has(on) || input.blackouts.has(`${on}/${w.fieldId}`)
        ? "blackout"
        : w.slots > 0 && w.cancelledSlots === w.slots
          ? "rained_out"
          : null;
    if (!reason) return [];
    const guess = guessFor(w);
    return [
      {
        windowId: w.id,
        permitNumber: w.permitNumber,
        holder: input.holder,
        on,
        borough: guess.borough,
        park: guess.park ?? w.venueName,
        field: w.fieldName,
        start: localTime(w.startsAt, timeZone),
        end: localTime(w.endsAt, timeZone),
        reason,
        office: officeFor(guess.borough, guess.park),
      },
    ];
  });

  return {
    fees,
    expectedCents,
    minutes,
    level: hoursLevel(minutes),
    unused,
  };
}
