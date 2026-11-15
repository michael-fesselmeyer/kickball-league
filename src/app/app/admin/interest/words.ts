import {
  FORM_ERRORS,
  MAX_OPTIONS,
  OPTION_ERRORS,
} from "@/domain/interest/interest";

/** What the admin page says for each `?error=` and `?notice=` code. */
export const ERRORS = {
  form_title: FORM_ERRORS.title,
  form_intro: FORM_ERRORS.intro,
  form_teams: FORM_ERRORS.teams,
  form_players: FORM_ERRORS.players,
  option_park: OPTION_ERRORS.park,
  option_night: OPTION_ERRORS.night,
  option_format: OPTION_ERRORS.format,
  option_empty: OPTION_ERRORS.empty,
  already_open: "A form is already open. Close it before opening another.",
  no_options: "Add at least one option.",
  duplicate_option: "Two options are the same. Remove one.",
  add_closed: "That form is closed.",
  add_duplicate: "That option is already on the form.",
  add_full: `A form can have up to ${MAX_OPTIONS} options.`,
  has_answers:
    "Someone picked that option, so it stays. Close the form instead.",
  last_option: "A form needs at least one option.",
  confirm: "Tick the box to confirm.",
  note: "Keep the note to 500 characters.",
  already_went: "That option already went ahead.",
  went_closed: "Reopen the form before sending a go-ahead.",
  email: "Type the address to delete.",
  no_answer: "No answer from that address.",
} as const;

export type ErrorKey = keyof typeof ERRORS;

export const isErrorKey = (value: string): value is ErrorKey =>
  Object.hasOwn(ERRORS, value);

export const NOTICES: Record<string, string> = {
  opened: "The form is open. Share its link with players.",
  target: "Target saved. The markers follow it.",
  closed: "The form is closed. No more answers.",
  reopened: "The form is open again.",
  added: "Option added.",
  removed: "Option removed.",
  "answer-removed": "That answer is deleted.",
};

/** "ahead-12" is a go-ahead that emailed 12 people. */
export function noticeText(code: string): string | undefined {
  const told = /^ahead-(\d{1,6})$/.exec(code)?.[1];
  if (told !== undefined)
    return Number(told) === 1
      ? "Going ahead. 1 person is being emailed."
      : `Going ahead. ${told} people are being emailed.`;
  return NOTICES[code];
}
