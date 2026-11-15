import { BRACKET_ERRORS } from "@/domain/tournaments/bracket";
import { SETTINGS_ERRORS } from "@/domain/tournaments/tournament";

/** What the tournament panel says for each `tournamentError` code. */
export const TOURNAMENT_ERRORS: Readonly<Record<string, string>> = {
  ...SETTINGS_ERRORS,
  ...BRACKET_ERRORS,
  not_a_tournament: "Only an event of kind Tournament can take guest teams.",
  partner_unknown: "Pick a league from the Friends of the league list.",
  under_cap: "More guest teams than that have signed up already.",
  in_bracket: "That team is in the bracket. Reset the bracket first.",
  no_team: "That team is already gone.",
  no_tournament: "Set the tournament up first.",
  already_drawn: "The bracket is already drawn. Reset it to draw again.",
  not_drawn: "Draw the bracket first.",
  has_results: "Games have been played, so the bracket can't be reset.",
  bad_time: "Give both a date and a time, or neither.",
};

/** What the panel says for each `tournamentSaved` code. */
export const TOURNAMENT_SAVED: Readonly<Record<string, string>> = {
  settings: "Tournament settings saved. The public page shows them now.",
  removed: "Guest team removed, with its waiver signatures.",
  drawn: "Bracket drawn. It's on the public page now.",
  reset: "Bracket cleared. Draw it again when the teams are set.",
  score: "Score saved.",
  schedule: "Game time and field saved.",
};
