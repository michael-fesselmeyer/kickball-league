import type { Topic } from "./topics";

/**
 * Alert cards (issue #529): instead of asking for notifications on a first
 * visit, the app offers one alert at the moment it clearly helps, with a
 * sample of the message. Each card asks once. "No thanks" keeps every card
 * away for a month, and cards never stack: at most one shows, and after any
 * answer the next one waits a week. Only "Yes" on a push card opens the
 * browser's permission prompt. See docs/product-spec.md, section 9.
 */
export const ALERT_CARDS = [
  "first_rsvp",
  "joined_team",
  "first_game",
  "season_end",
] as const;

export type AlertCard = (typeof ALERT_CARDS)[number];
export type CardAnswer = "yes" | "no";

export type CardCopy = {
  card: AlertCard;
  /** The topic a "Yes" turns on. */
  topic: Topic;
  /** Push cards ask the browser for permission; email cards don't. */
  channel: "push" | "email";
  question: string;
  detail: string;
  /** A made-up message of the kind the person would get. */
  sample: { title: string; body: string };
  yes: string;
};

/** The cards, in the order they are offered when several apply. */
export const CARD_COPY: Readonly<Record<AlertCard, CardCopy>> = {
  first_rsvp: {
    card: "first_rsvp",
    topic: "rainout",
    channel: "push",
    question: "Want a heads-up if your game gets rained out?",
    detail:
      "We'll ping your phone only when your game is off, starting late or back on.",
    sample: {
      title: "Rained out tonight",
      body: "Tuesday's 7 pm game is off. Makeup is next Tuesday, same field.",
    },
    yes: "Yes, ping me",
  },
  joined_team: {
    card: "joined_team",
    topic: "sub_request",
    channel: "push",
    question: "Get sub requests from your captain?",
    detail:
      "When a team needs a sub at a time you're free. Say yes or no with one tap.",
    sample: {
      title: "Sub needed Thursday",
      body: "Your captain needs one more player for 8 pm at the big field. In?",
    },
    yes: "Yes, send them",
  },
  first_game: {
    card: "first_game",
    topic: "announcement",
    channel: "email",
    question: "Weekly roundup, one email a week?",
    detail:
      "League news, events and parties in one email on Sundays. Game changes still come right away.",
    sample: {
      title: "This week in the league",
      body: "Playoff brackets are up, bar night moved to Friday, and photos from week 3.",
    },
    yes: "Yes, once a week",
  },
  season_end: {
    card: "season_end",
    topic: "announcement",
    channel: "email",
    question: "That's a wrap! Want to hear about next season?",
    detail:
      "The end-of-season survey, then a note when sign-ups open. Just a few emails until next season.",
    sample: {
      title: "How was your season?",
      body: "Two minutes, five questions. Tell us what to keep and what to fix.",
    },
    yes: "Yes, keep me posted",
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long every card stays away after a "No thanks". */
export const NO_THANKS_QUIET_DAYS = 30;

/** How long after any answer before the next card, so they never stack. */
export const BETWEEN_CARDS_DAYS = 7;

/** What has happened to the person, each fact the moment one card helps. */
export type CardMoments = {
  /** They answered an RSVP for a game. */
  rsvped: boolean;
  /** They are on a team's roster. */
  onTeam: boolean;
  /** A game their team played is over. */
  playedGame: boolean;
  /** The last season they played in is over. */
  seasonEnded: boolean;
};

export type PastAnswer = { card: AlertCard; answer: CardAnswer; at: Date };

const TRIGGER: Readonly<Record<AlertCard, (m: CardMoments) => boolean>> = {
  first_rsvp: (m) => m.rsvped,
  joined_team: (m) => m.onTeam,
  first_game: (m) => m.playedGame,
  season_end: (m) => m.seasonEnded,
};

/**
 * The one card to show now, or null. A card is offered when its moment has
 * come, it was never answered, and what it offers isn't already on
 * (`alreadyOn`); a card whose channel isn't available (`unavailable`, push
 * when the league has no push key) is skipped.
 */
export function nextCard({
  moments,
  answers,
  alreadyOn,
  unavailable = new Set(),
  now,
}: {
  moments: CardMoments;
  answers: readonly PastAnswer[];
  alreadyOn: ReadonlySet<AlertCard>;
  unavailable?: ReadonlySet<"push" | "email">;
  now: Date;
}): AlertCard | null {
  const since = (a: PastAnswer) => now.getTime() - a.at.getTime();
  if (
    answers.some(
      (a) => a.answer === "no" && since(a) < NO_THANKS_QUIET_DAYS * DAY_MS,
    )
  )
    return null;
  if (answers.some((a) => since(a) < BETWEEN_CARDS_DAYS * DAY_MS)) return null;
  const answered = new Set(answers.map((a) => a.card));
  return (
    ALERT_CARDS.find(
      (card) =>
        !answered.has(card) &&
        TRIGGER[card](moments) &&
        !alreadyOn.has(card) &&
        !unavailable.has(CARD_COPY[card].channel),
    ) ?? null
  );
}

/** The topic each card counts toward on the admins' alert page. */
export const cardsForTopic = (topic: Topic): AlertCard[] =>
  ALERT_CARDS.filter((card) => CARD_COPY[card].topic === topic);
