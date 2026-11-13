/**
 * The topics a league message can be about, and what each person receives
 * by default. "Useful features without overloading people"
 * (docs/product-spec.md): everything is on by default except marketing, and
 * every topic can be turned off.
 */
export const TOPICS = [
  "rainout",
  "schedule_change",
  "game_reminder",
  "payment",
  "sub_request",
  "announcement",
  "score",
  "events",
  "marketing",
  "new_team",
] as const;

export type Topic = (typeof TOPICS)[number];

export const DEFAULT_ENABLED: Readonly<Record<Topic, boolean>> = {
  rainout: true,
  schedule_change: true,
  game_reminder: true,
  payment: true,
  sub_request: true,
  announcement: true,
  score: true,
  events: true,
  marketing: false,
  new_team: true,
};

/**
 * The topics the settings page offers, in the order it shows them: only
 * those the league sends today. Each new kind of message adds its topic.
 */
export const SETTINGS_TOPICS: readonly {
  topic: Topic;
  label: string;
  hint: string;
}[] = [
  {
    topic: "announcement",
    label: "Announcements",
    hint: "News from league admins and your captain.",
  },
  {
    topic: "rainout",
    label: "Rain-outs",
    hint: "When your game is rained out, with its makeup time. Admins also get rain alerts the day before.",
  },
  {
    topic: "payment",
    label: "Payment reminders",
    hint: "7, 3 and 1 days before the deadline, until you have paid.",
  },
  {
    topic: "sub_request",
    label: "Sub requests",
    hint: "When a team needs a sub at a time you're free, and answers to your offers.",
  },
  {
    topic: "score",
    label: "Score reminders",
    hint: "For refs and captains, when a game you were in has no score yet.",
  },
  {
    topic: "new_team",
    label: "New-team requests",
    hint: "The league's answer when you ask to start a team, and, for captains, when a player leaves to start one.",
  },
];

export type Choice = { topic: Topic; enabled: boolean };

/** Whether a person gets email about `topic`, given the choices they saved. */
export function wantsEmail(choices: readonly Choice[], topic: Topic): boolean {
  return (
    choices.find((c) => c.topic === topic)?.enabled ?? DEFAULT_ENABLED[topic]
  );
}
