/** Test data: the scheduler's worked example laid out as board slots. */
import { workedExample } from "@/domain/scheduler/worked-example.fixture";
import type { BoardSlot } from "./board-model";

export const [input, schedule] = workedExample();

export function boardSlots(): BoardSlot[] {
  return input.slots.map((s) => ({
    id: s.id,
    date: s.date,
    timeIndex: s.timeIndex,
    fieldId: s.fieldId,
    day: s.date,
    time: ["10:00 AM", "11:30 AM", "1:00 PM"][s.timeIndex]!,
    field: s.fieldId === "F1" ? "Field 1" : "Field 2",
    kind: s.kind,
    cancelled: false,
  }));
}
