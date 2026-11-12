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
    topic: "payment",
    label: "Payment reminders",
    hint: "7, 3 and 1 days before the deadline, until you have paid.",
  },
];

export type Choice = { topic: Topic; enabled: boolean };

/** Whether a person gets email about `topic`, given the choices they saved. */
export function wantsEmail(choices: readonly Choice[], topic: Topic): boolean {
  return (
    choices.find((c) => c.topic === topic)?.enabled ?? DEFAULT_ENABLED[topic]
  );
}
