/**
 * The live line score's words (`en.live`). A module of its own because the
 * live score is a client component: it imports this small English default,
 * and a page in another language passes `messagesFor(locale).live` as a
 * prop, so the browser never downloads a catalog.
 */
export const liveEn = {
  caption: "Runs by inning",
  team: "Team",
  runs: "Runs",
  runsShort: "R",
  calledNote:
    "The game was called, so it stands at the end of the {nth}. Runs after that don’t count.",
  calledAfter: "called after the {nth}",
  finalCalled: "Final, {called}",
  gameOver: "Game over: waiting for confirmation",
  gameOverCalled: "Game over, {called}: waiting for confirmation",
  liveAt: "Live: {position}",
  live: "Live",
  top: "Top of the {nth}",
  bottom: "Bottom of the {nth}",
  heading: "Inning by inning",
  scoredLive: "Scored live, inning by inning. Thanks to whoever kept score!",
  unofficial: "Unofficial until final.",
  unofficialMore:
    "The final score is reported after the game and confirmed by the captains.",
} as const;

export type LiveWords = { readonly [K in keyof typeof liveEn]: string };
