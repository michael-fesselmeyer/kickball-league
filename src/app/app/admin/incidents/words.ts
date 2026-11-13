import type { SuspensionView } from "@/db/queries/discipline";
import {
  describeLength,
  type ReporterRole,
} from "@/domain/discipline/discipline";

export const REPORTED_BY: Record<ReporterRole, string> = {
  referee: "the ref",
  captain: "a captain",
  admin: "an admin",
};

/** "1 game, 1 more to serve · Fall 2026", "permanently · lifted". */
export function suspensionLine(s: SuspensionView): string {
  const length = describeLength(s.length);
  const state =
    s.state.state === "lifted"
      ? "lifted"
      : s.state.state === "served"
        ? "served"
        : s.state.gamesLeft !== null
          ? `${s.state.gamesLeft} more to serve`
          : "in force";
  return `${length[0]?.toUpperCase()}${length.slice(1)}, ${state} · ${s.seasonName}`;
}
