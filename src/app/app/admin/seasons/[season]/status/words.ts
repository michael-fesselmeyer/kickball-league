import type { StatusError } from "@/domain/gameday/status";

export const ERRORS: Record<StatusError | "no_games", string> = {
  bad_state: "Pick On, Watching, Delayed or Off.",
  reason_too_long: "Keep the reason short: 120 characters at most.",
  decide_by_missing: "Say by when the league will decide.",
  decide_by_past: "The decision time has to be later than now.",
  decide_by_after_start: "Decide before the first game starts.",
  pick_games: "Tick the games this applies to, or All games.",
  start_missing: "Give each delayed game its new start time.",
  start_not_later:
    "A delayed game's new start has to be later than its scheduled one.",
  day_over: "Every game that day has started, so its status can't change now.",
  no_games: "There are no games on that day.",
};

export const NOTICES: Record<string, string> = {
  saved:
    "Saved. The schedule, game pages and players' home screens show it now.",
  told: "Saved, and the players in the affected games are being told.",
};
