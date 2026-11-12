import type { Question } from "@/lib/seo/structured-data";

export type Faq = Question & {
  /** Where to read more, shown under the answer. */
  more?: { href: string; label: string };
};

export type FaqGroup = { id: string; title: string; questions: Faq[] };

/**
 * The FAQ page and its structured data both read this list, so what search
 * engines see is exactly what visitors read. Answers are plain text and lead
 * with the answer (docs/seo-plan.md, section 4).
 */
export const FAQ: FaqGroup[] = [
  {
    id: "joining",
    title: "Joining",
    questions: [
      {
        question: "Do I need a team to join?",
        answer:
          "No. Sign up as a free agent and the league places you on a team before the season starts. Lots of players come solo, and it's the quickest way to meet people.",
      },
      {
        question: "How do I join a friend's team?",
        answer:
          "Ask your captain for the team's invite link. Open it, sign in with your email, sign the waiver and pay your share if the team is splitting the fee. That's it, you're on the roster.",
      },
      {
        question: "How old do I have to be?",
        answer:
          "You need to be 18 or older to play. Some social events at bars are 21 and over, and their event pages say so.",
      },
      {
        question: "Do I need to be good at kickball?",
        answer:
          "Not at all. If you remember recess, you're qualified. Games are friendly, the refs explain calls, and nobody minds a whiff.",
      },
    ],
  },
  {
    id: "season",
    title: "The season",
    questions: [
      {
        question: "When are games?",
        answer:
          "It depends on the season and the park permits: Sunday afternoons in summer, weeknight evenings in spring and fall. Each season's page lists its exact day and times before registration opens.",
      },
      {
        question: "Where do we play?",
        answer:
          "McCarren Park in Brooklyn, on the border of Greenpoint and Williamsburg. Your game page names your field.",
        more: {
          href: "/parks/mccarren-park",
          label: "Getting to McCarren Park",
        },
      },
      {
        question: "How much does it cost?",
        answer:
          "The fee is set each season and shown on the season's page, with what it includes, before you pay anything. Some seasons charge per player and some per team. When a team splits its fee, each player pays their own share online.",
      },
      {
        question: "How long is a game?",
        answer:
          "Each game fits in a one-hour slot, so you're done in time for dinner, or a drink (or a seltzer) with your team.",
      },
      {
        question: "Is the league coed?",
        answer:
          "Yes. Every team plays mixed, and lineups follow the league's gender-balance rule, which your captain and the ref keep an eye on.",
      },
      {
        question: "What happens if it rains?",
        answer:
          "A person at the league watches the forecast and makes the call, usually the day before. If your game is rained out, your game page shows it, and the makeup time appears there once it's set.",
      },
    ],
  },
  {
    id: "game-day",
    title: "Game day",
    questions: [
      {
        question: "What should I wear?",
        answer:
          "Sneakers or turf shoes, something in your team's color, and a layer for evening games. Bring water and sunscreen in summer.",
      },
      {
        question: "Do I have to drink?",
        answer:
          "Nope. Hanging out after the game is part of the fun, but it's a drink or a seltzer, your call, and plenty of people skip it. Drinks wait until after the game, since alcohol isn't allowed in city parks.",
      },
      {
        question: "Can friends come and watch?",
        answer:
          "Of course. It's a public park, and a few fans on the sideline never hurt anyone's kicking.",
      },
    ],
  },
];

export const ALL_QUESTIONS: Faq[] = FAQ.flatMap((group) => group.questions);
