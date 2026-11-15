import { db } from "@/db/client";
import { commandDate, commandRows } from "@/db/queries/command-center";
import {
  type CommandState,
  commandState,
} from "@/domain/gameday/command-center";
import type { LeagueId } from "@/domain/ids";

/** A YYYY-MM-DD date from a query string, or null. */
export function parseDay(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

/**
 * The command center's state for a day: the one asked for, else today (or
 * the next game day). Two reads at most: the day, then every game on it.
 * Never cached: a handful of admins poll it, and each poll must see a score
 * or a check-in the moment it is saved.
 */
export async function loadCommand(
  leagueId: LeagueId,
  now: Date,
  asked: string | null,
) {
  const date = asked ?? (await commandDate(db, leagueId, now));
  if (!date) return null;
  const rows = await commandRows(db, leagueId, date);
  const state: CommandState = commandState(rows, date, now);
  return { state, rows };
}
