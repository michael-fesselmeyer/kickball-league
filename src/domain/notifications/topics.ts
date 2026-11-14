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
  /**
   * A suspension notice. Not offered on the settings page: the league must
   * be able to tell a player they are suspended and how to appeal.
   */
  "discipline",
  // The digest of held non-urgent messages (limits.ts). Not offered on the
  // settings page: the person already wanted each message inside it.
  "digest",
  // Notices about the league's own running, such as the email quota, for
  // admins. Not offered on the settings page.
  "operations",
  "photos",
  "team_roles",
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
  discipline: true,
  digest: true,
  operations: true,
  photos: true,
  team_roles: true,
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
    hint: "When a team needs a sub at a time you're free, and answers to your offers. For captains, when players' away weeks leave your team short.",
  },
  {
    topic: "score",
    label: "Scores",
    hint: "For captains, when the other team or the ref reports your game's score and you need to confirm it. For refs and captains, when a game you were in has no score yet.",
  },
  {
    topic: "new_team",
    label: "New-team requests",
    hint: "The league's answer when you ask to start a team, and, for captains, when a player leaves to start one.",
  },
  {
    topic: "team_roles",
    label: "Captain and co-captains",
    hint: "When your captain offers you the captaincy or makes you a co-captain, and the answer to a captaincy you offered.",
  },
  {
    topic: "events",
    label: "Events",
    hint: "When a spot opens for an event you're waitlisted for, or an event you RSVP'd to is called off.",
  },
  {
    topic: "photos",
    label: "Your photos",
    hint: "Whether the league used a photo you uploaded.",
  },
];

export type Choice = { topic: Topic; enabled: boolean };

/**
 * The topics that can also come as a web push, in the order the settings
 * page shows them: the time-sensitive ones a player acts on at the field.
 * Push is opt-in: off for every topic until the person turns it on.
 */
export const PUSH_TOPICS: readonly {
  topic: Topic;
  label: string;
  hint: string;
}[] = [
  {
    topic: "rainout",
    label: "Rain-outs",
    hint: "When your game is rained out.",
  },
  {
    topic: "sub_request",
    label: "Sub requests",
    hint: "When a team needs a sub, and answers to your offers.",
  },
  {
    topic: "score",
    label: "Score confirmations",
    hint: "When a score needs your confirmation, or a game you were in has no score yet.",
  },
];

/** Whether `topic` can be sent as a web push at all. */
export const isPushTopic = (topic: Topic): boolean =>
  PUSH_TOPICS.some((t) => t.topic === topic);

/**
 * Whether a person gets a push about `topic`, given the push choices they
 * saved. Off unless they turned it on.
 */
export function wantsPush(choices: readonly Choice[], topic: Topic): boolean {
  return (
    isPushTopic(topic) &&
    (choices.find((c) => c.topic === topic)?.enabled ?? false)
  );
}

/** Whether a person gets email about `topic`, given the choices they saved. */
export function wantsEmail(choices: readonly Choice[], topic: Topic): boolean {
  return (
    choices.find((c) => c.topic === topic)?.enabled ?? DEFAULT_ENABLED[topic]
  );
}
