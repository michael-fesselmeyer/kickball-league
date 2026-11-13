import { TURNOUT, vibeLabel, type Availability, type Position } from "./quiz";

/**
 * The free-agent matcher (roadmap section 4, milestone 5; product-spec.md,
 * "League admin": "Place free agents on teams with suggestions from the
 * matcher"). Pure and deterministic: the same pool and teams always give the
 * same suggestions, each with plain-language reasons. An admin applies them.
 *
 * What it promises, and its property tests check:
 * - Friend groups stay together. A group goes to one team, or nowhere; a
 *   group with someone already on a team goes to that team or nowhere.
 * - No team goes over its capacity (its target roster size, capped by the
 *   season's roster maximum).
 * - The fielding rule comes first. Each team wants half its roster from
 *   each side of the rule (women and men, by the fielding group in their
 *   profile), so it can field a full lineup on a night when some players
 *   are away. A team's shortfall is how far below that it is on each side,
 *   squared, so the team furthest short feels it most. Adding players never
 *   raises a shortfall, so every team's fielding balance improves or holds,
 *   and each placement goes where it cuts a shortfall the most.
 * - Then open spots, so teams fill evenly, and after that vibe, experience
 *   and positions.
 *
 * Players with no fielding group in their profile are matched on the rest.
 *
 * - A team never gets someone on its "not on my team" list (ADR 0036), nor
 *   a friend group with them in it.
 */

export type LineupSide = "woman" | "man";

/** What the matcher knows about a person, from their profile and quiz. */
export type Player = {
  side: LineupSide | null;
  /** 1 to 5, or null without a quiz. */
  skill: number | null;
  /** 1 (social) to 5 (competitive), or null without a quiz. */
  vibe: number | null;
  availability: Availability | null;
  positions: readonly Position[];
  /** Their friend group this season, if any. */
  groupId: string | null;
};

export type PoolPlayer = Player & {
  registrationId: string;
  name: string;
  captain: "yes" | "help" | "no" | null;
  /** Sign-up order, for stable tie-breaks. Lower is earlier. */
  order: number;
};

export type MatchTeam = {
  teamSeasonId: string;
  name: string;
  capacity: number;
  members: readonly Player[];
  /** Registrations on the team's "not on my team" list. */
  keepOff?: readonly string[];
};

export type Suggestion = {
  teamSeasonId: string;
  teamName: string;
  registrationIds: string[];
  names: string[];
  reasons: string[];
};

export type Unplaced = {
  registrationIds: string[];
  names: string[];
  reason: string;
};

export type TeamOutlook = {
  teamSeasonId: string;
  name: string;
  capacity: number;
  before: { players: number; women: number; men: number };
  after: { players: number; women: number; men: number };
};

export type MatchResult = {
  suggestions: Suggestion[];
  unplaced: Unplaced[];
  teams: TeamOutlook[];
};

/**
 * Fielding outweighs everything else put together: two different fielding
 * gains differ by at least 1, worth 100, and the other terms span at most
 * 45 points (open spots 20, vibe 10, experience -5 to 5, a position 5).
 */
const FIELDING_WEIGHT = 100;
const ROOM_WEIGHT = 20;

type Unit = {
  players: PoolPlayer[];
  /** The team a group member already plays for. */
  anchor: string | null;
};

type TeamState = {
  team: MatchTeam;
  players: number;
  women: number;
  men: number;
  /** Players wanted from each side of the fielding rule. */
  need: number;
  turnout: number;
  skills: number[];
  vibes: number[];
  positions: Set<Position>;
  groups: Set<string>;
  start: { players: number; women: number; men: number };
};

const average = (xs: readonly number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const turnoutOf = (p: Player) =>
  p.availability ? TURNOUT[p.availability] : TURNOUT.most_weeks;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Players a team of `capacity` wants from each side of the fielding rule. */
export const sideNeed = (capacity: number) => Math.ceil(capacity / 2);

/** How far short a team is on each side, squared; 0 means none. */
export function fieldingShortfall(team: {
  women: number;
  men: number;
  need: number;
}): number {
  const short = (n: number) => Math.max(0, team.need - n) ** 2;
  return short(team.women) + short(team.men);
}

/** How much adding `players` cuts a team's shortfall; never negative. */
export function fieldingGain(
  team: { women: number; men: number; need: number },
  players: readonly Pick<Player, "side">[],
): number {
  const women = players.filter((p) => p.side === "woman").length;
  const men = players.filter((p) => p.side === "man").length;
  return (
    fieldingShortfall(team) -
    fieldingShortfall({
      women: team.women + women,
      men: team.men + men,
      need: team.need,
    })
  );
}

function stateOf(team: MatchTeam): TeamState {
  const women = team.members.filter((m) => m.side === "woman").length;
  const men = team.members.filter((m) => m.side === "man").length;
  return {
    team,
    players: team.members.length,
    women,
    men,
    need: sideNeed(team.capacity),
    turnout: team.members.reduce((t, m) => t + turnoutOf(m), 0),
    skills: team.members.flatMap((m) => (m.skill === null ? [] : [m.skill])),
    vibes: team.members.flatMap((m) => (m.vibe === null ? [] : [m.vibe])),
    positions: new Set(team.members.flatMap((m) => m.positions)),
    groups: new Set(team.members.flatMap((m) => m.groupId ?? [])),
    start: { players: team.members.length, women, men },
  };
}

/** Groups first (bigger is harder to fit), then single players by sign-up. */
function unitsOf(pool: readonly PoolPlayer[], teams: TeamState[]): Unit[] {
  const byGroup = new Map<string, PoolPlayer[]>();
  const units: Unit[] = [];
  for (const p of [...pool].sort((a, b) => a.order - b.order)) {
    if (p.groupId === null) {
      units.push({ players: [p], anchor: null });
      continue;
    }
    const group = byGroup.get(p.groupId);
    if (group) group.push(p);
    else {
      const players = [p];
      byGroup.set(p.groupId, players);
      const anchor =
        teams.find((t) => t.groups.has(p.groupId as string))?.team
          .teamSeasonId ?? null;
      units.push({ players, anchor });
    }
  }
  const first = (u: Unit) => u.players[0]?.order ?? 0;
  return units.sort(
    (a, b) =>
      Number(b.anchor !== null) - Number(a.anchor !== null) ||
      b.players.length - a.players.length ||
      first(a) - first(b),
  );
}

type Scored = {
  state: TeamState;
  score: number;
  gain: number;
  room: number;
  vibe: number;
  skill: number;
  position: Position | null;
};

function score(
  state: TeamState,
  unit: Unit,
  leagueSkill: number | null,
): Scored {
  const { team } = state;
  const gain = fieldingGain(state, unit.players);
  const room = ROOM_WEIGHT * Math.max(0, 1 - state.turnout / team.capacity);

  const unitVibe = average(unit.players.flatMap((p) => p.vibe ?? []));
  const teamVibe = average(state.vibes);
  const vibe =
    unitVibe === null || teamVibe === null
      ? 5
      : Math.max(0, 10 - 2.5 * Math.abs(unitVibe - teamVibe));

  // Experience counts only once the team has some to compare against.
  let skill = 0;
  const unitSkills = unit.players.flatMap((p) => p.skill ?? []);
  const before = average(state.skills);
  if (leagueSkill !== null && before !== null && unitSkills.length > 0) {
    const after = average([...state.skills, ...unitSkills]) ?? before;
    const better =
      Math.abs(before - leagueSkill) - Math.abs(after - leagueSkill);
    skill = 5 * Math.max(-1, Math.min(1, better));
  }

  const wanted = (["pitcher", "catcher"] as const).find(
    (p) =>
      !state.positions.has(p) &&
      unit.players.some((u) => u.positions.includes(p)),
  );
  const position = wanted ?? null;

  return {
    state,
    score: FIELDING_WEIGHT * gain + room + vibe + skill + (position ? 5 : 0),
    gain,
    room,
    vibe,
    skill,
    position,
  };
}

const names = (players: readonly PoolPlayer[]) => players.map((p) => p.name);

/** Whether the team's list keeps anyone in `players` off it. */
export const keepsOff = (
  team: Pick<MatchTeam, "keepOff">,
  players: readonly Pick<PoolPlayer, "registrationId">[],
) => players.some((p) => team.keepOff?.includes(p.registrationId) === true);

function joinNames(list: readonly string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

function reasonsFor(
  best: Scored,
  candidates: readonly Scored[],
  unit: Unit,
  leagueSkill: number | null,
): string[] {
  const { state } = best;
  const name = state.team.name;
  const reasons: string[] = [];
  if (unit.players.length > 1)
    reasons.push(`Keeps ${joinNames(names(unit.players))} together.`);
  if (best.gain > 0)
    reasons.push(
      `Helps ${name} field a full lineup: it has ${plural(state.women, "woman", "women")} and ${plural(state.men, "man", "men")}.`,
    );
  if (best.position)
    reasons.push(
      `Wants to ${best.position === "pitcher" ? "pitch" : "catch"}, and nobody on ${name} has said they do.`,
    );
  const teamVibe = average(state.vibes);
  const unitVibe = average(unit.players.flatMap((p) => p.vibe ?? []));
  if (
    teamVibe !== null &&
    unitVibe !== null &&
    Math.abs(teamVibe - unitVibe) <= 1
  )
    reasons.push(`Same vibe: ${name} is ${vibeLabel(teamVibe)}.`);
  // A positive skill score means the team moves toward the league's
  // average: a newer team gains experience, or an experienced one gains
  // newer players it can show the ropes.
  const teamSkill = average(state.skills);
  if (best.skill > 0 && leagueSkill !== null && teamSkill !== null)
    reasons.push(
      teamSkill < leagueSkill
        ? `Brings experience to ${name}, a newer team.`
        : `Joins ${name}, an experienced team that can show them the ropes.`,
    );
  const mostRoom = Math.max(...candidates.map((c) => c.room));
  if (reasons.length < 3 && best.room >= mostRoom)
    reasons.push(
      `${name} expects the fewest players on game day (${state.players} of ${state.team.capacity} spots filled).`,
    );
  if (reasons.length === 0)
    reasons.push(
      `${name} has room: ${state.players} of ${state.team.capacity} spots filled.`,
    );
  return reasons.slice(0, 3);
}

function add(state: TeamState, players: readonly PoolPlayer[]) {
  for (const p of players) {
    state.players += 1;
    if (p.side === "woman") state.women += 1;
    if (p.side === "man") state.men += 1;
    state.turnout += turnoutOf(p);
    if (p.skill !== null) state.skills.push(p.skill);
    if (p.vibe !== null) state.vibes.push(p.vibe);
    for (const pos of p.positions) state.positions.add(pos);
    if (p.groupId) state.groups.add(p.groupId);
  }
}

/** Best first; ties go to the team with fewer players, then by name and id. */
function byScore(a: Scored, b: Scored): number {
  return (
    b.score - a.score ||
    a.state.players - b.state.players ||
    a.state.team.name.localeCompare(b.state.team.name) ||
    a.state.team.teamSeasonId.localeCompare(b.state.team.teamSeasonId)
  );
}

/** Suggests a team for everyone in the pool who fits somewhere. */
export function suggestPlacements(
  pool: readonly PoolPlayer[],
  teams: readonly MatchTeam[],
): MatchResult {
  const states = teams.map(stateOf);
  const knownSkills = [
    ...pool.flatMap((p) => p.skill ?? []),
    ...teams.flatMap((t) => t.members.flatMap((m) => m.skill ?? [])),
  ];
  const leagueSkill = average(knownSkills);
  const suggestions: Suggestion[] = [];
  const unplaced: Unplaced[] = [];

  for (const unit of unitsOf(pool, states)) {
    const size = unit.players.length;
    const fits = (s: TeamState) => s.team.capacity - s.players >= size;
    const who = joinNames(names(unit.players));

    if (unit.anchor !== null) {
      const home = states.find((s) => s.team.teamSeasonId === unit.anchor);
      if (!home) continue;
      if (keepsOff(home.team, unit.players)) {
        unplaced.push({
          registrationIds: unit.players.map((p) => p.registrationId),
          names: names(unit.players),
          reason: `Their friend group is on ${home.team.name}, whose captain has ${size === 1 ? "them" : "one of them"} on the team's list.`,
        });
        continue;
      }
      if (!fits(home)) {
        unplaced.push({
          registrationIds: unit.players.map((p) => p.registrationId),
          names: names(unit.players),
          reason: `Their friend group is on ${home.team.name}, which has no room for ${size === 1 ? "one more" : `${size} more`}.`,
        });
        continue;
      }
      const scored = score(home, unit, leagueSkill);
      const reasons = [
        `Joins their friend group on ${home.team.name}.`,
        ...reasonsFor(scored, [scored], unit, leagueSkill).filter(
          (r) => !r.startsWith("Keeps "),
        ),
      ].slice(0, 3);
      suggestions.push({
        teamSeasonId: home.team.teamSeasonId,
        teamName: home.team.name,
        registrationIds: unit.players.map((p) => p.registrationId),
        names: names(unit.players),
        reasons,
      });
      add(home, unit.players);
      continue;
    }

    const candidates = states
      .filter((s) => fits(s) && !keepsOff(s.team, unit.players))
      .map((s) => score(s, unit, leagueSkill))
      .sort(byScore);
    const best = candidates[0];
    if (!best) {
      unplaced.push({
        registrationIds: unit.players.map((p) => p.registrationId),
        names: names(unit.players),
        reason: states.some((s) => fits(s))
          ? `Every team with room has ${size > 1 ? "one of them" : "them"} on its list.`
          : size > 1
            ? `No team has room for ${who} together.`
            : "Every team is full.",
      });
      continue;
    }
    suggestions.push({
      teamSeasonId: best.state.team.teamSeasonId,
      teamName: best.state.team.name,
      registrationIds: unit.players.map((p) => p.registrationId),
      names: names(unit.players),
      reasons: reasonsFor(best, candidates, unit, leagueSkill),
    });
    add(best.state, unit.players);
  }

  return {
    suggestions,
    unplaced,
    teams: states.map((s) => ({
      teamSeasonId: s.team.teamSeasonId,
      name: s.team.name,
      capacity: s.team.capacity,
      before: s.start,
      after: { players: s.players, women: s.women, men: s.men },
    })),
  };
}

export type NewTeamSuggestion = {
  captainId: string | null;
  registrationIds: string[];
  reasons: string[];
};

/**
 * A starting roster for a new team built from the pool: a volunteer captain
 * (or a helper, if nobody said "sure"), then whole friend groups chosen to
 * even out the fielding rule, up to `size` players.
 */
export function suggestNewTeam(
  pool: readonly PoolPlayer[],
  size: number,
): NewTeamSuggestion {
  const ordered = [...pool].sort((a, b) => a.order - b.order);
  const captainRank = { yes: 0, help: 1, no: 2 } as const;
  const captain =
    [...ordered]
      .filter((p) => p.captain === "yes" || p.captain === "help")
      .sort(
        (a, b) =>
          captainRank[a.captain ?? "no"] - captainRank[b.captain ?? "no"] ||
          (b.skill ?? 0) - (a.skill ?? 0) ||
          a.order - b.order,
      )[0] ?? null;

  const units: PoolPlayer[][] = [];
  const byGroup = new Map<string, PoolPlayer[]>();
  for (const p of ordered) {
    if (p.groupId === null) units.push([p]);
    else {
      const group = byGroup.get(p.groupId);
      if (group) group.push(p);
      else {
        const players = [p];
        byGroup.set(p.groupId, players);
        units.push(players);
      }
    }
  }

  const team = { women: 0, men: 0, players: 0, need: sideNeed(size) };
  const chosen: PoolPlayer[] = [];
  const take = (unit: PoolPlayer[]) => {
    chosen.push(...unit);
    team.players += unit.length;
    team.women += unit.filter((p) => p.side === "woman").length;
    team.men += unit.filter((p) => p.side === "man").length;
    units.splice(units.indexOf(unit), 1);
  };
  const captainUnit = captain
    ? units.find((u) => u.includes(captain))
    : undefined;
  if (captainUnit && captainUnit.length <= size) take(captainUnit);

  for (;;) {
    const room = size - team.players;
    const options = units.filter((u) => u.length <= room);
    if (options.length === 0) break;
    // The biggest cut in the fielding shortfall first; then bigger groups,
    // which are harder to place later; then whoever signed up first.
    const best = options
      .map((u, i) => ({ u, i, gain: fieldingGain(team, u) }))
      .sort(
        (a, b) => b.gain - a.gain || b.u.length - a.u.length || a.i - b.i,
      )[0];
    if (!best) break;
    take(best.u);
  }

  const reasons: string[] = [];
  const leader = captainUnit && chosen.includes(captainUnit[0] as PoolPlayer);
  if (captain && leader)
    reasons.push(
      captain.captain === "yes"
        ? `${captain.name} offered to captain.`
        : `${captain.name} offered to help captain; nobody else volunteered.`,
    );
  else reasons.push("Nobody in the pool offered to captain yet.");
  reasons.push(
    `${plural(team.players, "player", "players")}: ${plural(team.women, "woman", "women")} and ${plural(team.men, "man", "men")}.`,
  );
  const groups = new Set(chosen.flatMap((p) => p.groupId ?? []));
  if (groups.size > 0)
    reasons.push(
      `Keeps ${plural(groups.size, "friend group", "friend groups")} together.`,
    );
  return {
    captainId: leader && captain ? captain.registrationId : null,
    registrationIds: chosen.map((p) => p.registrationId),
    reasons,
  };
}
