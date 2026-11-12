import { sideOf, stableHash, type StatGame, winnerOf } from "./games";
import { type RankedWithMovement } from "./power";
import { type LeagueRecord, RECORD_TITLES, recordValue } from "./records";
import { streakNote, type TeamStreaks } from "./streaks";

/**
 * The weekly recap draft: plain text an admin edits before sending it as an
 * announcement. Built from templates, never a model, so the same scores
 * always give the same draft.
 */

/** The announcement limits (src/db/queries/announcements.ts). */
export const RECAP_SUBJECT_MAX = 120;
export const RECAP_BODY_MAX = 5000;

export type RecapInput = {
  seasonName: string;
  /** "Sunday, November 8" */
  dayLabel: string;
  /** The day's finished games. */
  games: readonly StatGame[];
  name: (team: string) => string;
  /** Rankings after the day, with movement since before it. */
  power: readonly RankedWithMovement[];
  streaks: ReadonlyMap<string, TeamStreaks>;
  /** Records first set on the day. */
  records: readonly LeagueRecord[];
  /** Next week's game of the week, already worded. */
  nextUp: string | null;
  /** Where to read more, such as the standings page. */
  link: string | null;
};

export type Recap = { subject: string; body: string };

const pick = <T>(seed: string, options: readonly [T, ...T[]]): T =>
  options[stableHash(seed) % options.length] ?? options[0];

/** One line for one game. */
export function resultSentence(
  game: StatGame,
  name: (team: string) => string,
): string {
  const winner = winnerOf(game);
  if (game.result.kind === "forfeit") {
    const w = name(winner ?? game.teamA);
    const l = name(winner === game.teamA ? game.teamB : game.teamA);
    return `${w} took the win by forfeit over ${l}.`;
  }
  if (winner === null) {
    const s = game.result.scoreA;
    return pick(game.id, [
      `${name(game.teamA)} and ${name(game.teamB)} called it even at ${s}–${s}. Everyone buys their own round.`,
      `${name(game.teamA)} and ${name(game.teamB)} tied ${s}–${s}. Nobody blinked.`,
    ]);
  }
  const loser = winner === game.teamA ? game.teamB : game.teamA;
  const side = sideOf(game, winner);
  const w = name(winner);
  const l = name(loser);
  const runsFor = side.runsFor ?? 0;
  const runsAgainst = side.runsAgainst ?? 0;
  const score = `${runsFor}–${runsAgainst}`;
  const margin = runsFor - runsAgainst;
  if (runsAgainst === 0)
    return pick(game.id, [
      `${w} blanked ${l} ${score}. Not a single run allowed.`,
      `${w} shut out ${l} ${score}.`,
    ]);
  if (margin >= 8)
    return pick(game.id, [
      `${w} ran away with it, beating ${l} ${score}.`,
      `${w} put on a clinic against ${l}, ${score}.`,
    ]);
  if (margin === 1)
    return pick(game.id, [
      `${w} edged ${l} ${score} in a nail-biter.`,
      `${w} held on to beat ${l} ${score}. Hearts were in throats.`,
    ]);
  return pick(game.id, [
    `${w} beat ${l} ${score}.`,
    `${w} got past ${l} ${score}.`,
    `${w} took care of business against ${l}, ${score}.`,
  ]);
}

const trim = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export function weeklyRecap(input: RecapInput): Recap {
  const { name } = input;
  const subject = trim(
    `${input.seasonName} recap: ${input.dayLabel}`,
    RECAP_SUBJECT_MAX,
  );
  const sections: string[] = [];

  sections.push(
    input.games.length === 0
      ? `No final scores from ${input.dayLabel} yet.`
      : [
          `Here's how ${input.dayLabel} went down.`,
          ...input.games.map((g) => `- ${resultSentence(g, name)}`),
        ].join("\n"),
  );

  const top = input.power.slice(0, 3);
  if (top.length > 0) {
    const climber = [...input.power]
      .filter((r) => r.movement !== null && r.movement > 0)
      .sort((a, b) => (b.movement ?? 0) - (a.movement ?? 0))[0];
    const lines = top.map((r) => `${r.rank}. ${name(r.team)}`);
    if (climber && climber.movement !== null)
      lines.push(
        `Biggest climber: ${name(climber.team)}, up ${climber.movement} to number ${climber.rank}.`,
      );
    sections.push(["Power rankings", ...lines].join("\n"));
  }

  const playedToday = new Set(input.games.flatMap((g) => [g.teamA, g.teamB]));
  const notes = [...input.streaks.values()]
    .filter((s) => playedToday.has(s.team))
    .flatMap((s) => {
      const note = streakNote(name(s.team), s.current);
      return note ? [{ note, length: s.current?.length ?? 0 }] : [];
    })
    .sort((a, b) => b.length - a.length || a.note.localeCompare(b.note))
    .slice(0, 3)
    .map((n) => n.note);
  if (notes.length > 0) sections.push(["Streak watch", ...notes].join("\n"));

  if (input.records.length > 0)
    sections.push(
      [
        "New league records",
        ...input.records.map(
          (r) =>
            `- ${RECORD_TITLES[r.key]}: ${r.team ? `${name(r.team)}, ` : ""}${recordValue(r).toLowerCase()}.`,
        ),
      ].join("\n"),
    );

  if (input.nextUp) sections.push(`Game of the week\n${input.nextUp}`);

  sections.push(
    input.link
      ? `Full standings: ${input.link}\nSee you on the field.`
      : "See you on the field.",
  );

  return { subject, body: trim(sections.join("\n\n"), RECAP_BODY_MAX) };
}
