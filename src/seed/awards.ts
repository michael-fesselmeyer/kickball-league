import type { Db } from "@/db/queries/schedule";
import { awardPoll, awardVote } from "@/db/schema";
import { defaultTitle } from "@/domain/awards/awards";
import type { AwardPollId, TeamSeasonId } from "@/domain/ids";
import { seededRandom } from "@/domain/random";
import { PLAYED_ROUNDS, type SeedData } from "./generate";

/**
 * Awards for the demo's fall season: last game day's MVP, closed with its
 * results in, and two polls still open (the season's best sport and last
 * game day's team spirit) that nobody on the demo player's team has voted
 * in yet, so a demo visitor can cast a vote. The open polls close a week
 * after `now`, so they stay open between demo resets.
 */
const pollId = (n: number) =>
  `a3a30000-0000-4000-8000-${String(n).padStart(12, "0")}` as AwardPollId;

export function seedAwardRows(data: SeedData, now: Date) {
  const random = seededRandom(175);
  const lastRound = data.games.filter((g) => g.roundNo === PLAYED_ROUNDS);
  const played = new Set(lastRound.flatMap((g) => [g.teamAId, g.teamBId]));
  const firstSlot = data.slots.find((s) => s.id === lastRound[0]?.slotId);
  if (!firstSlot) throw new Error("The seed has no played game day");
  const gameDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: data.league.timezone,
  }).format(firstSlot.startsAt);
  const dayAfter = new Date(firstSlot.startsAt.getTime() + 16 * 3_600_000);

  const players = data.rosterMemberships.flatMap((m) => {
    const r = data.registrations.find((x) => x.id === m.registrationId);
    return r ? [{ userId: r.userId, teamSeasonId: m.teamSeasonId }] : [];
  });
  const polls = [
    {
      id: pollId(1),
      seasonId: data.season.id,
      kind: "weekly" as const,
      category: "mvp" as const,
      title: defaultTitle("weekly", "mvp", gameDay, data.season.name),
      gameDay,
      opensAt: dayAfter,
      closesAt: new Date(dayAfter.getTime() + 3 * 86_400_000),
    },
    {
      id: pollId(2),
      seasonId: data.season.id,
      kind: "season" as const,
      category: "best_sport" as const,
      title: defaultTitle("season", "best_sport", null, data.season.name),
      gameDay: null,
      opensAt: new Date(now.getTime() - 86_400_000),
      closesAt: new Date(now.getTime() + 7 * 86_400_000),
    },
    {
      id: pollId(3),
      seasonId: data.season.id,
      kind: "weekly" as const,
      category: "team_spirit" as const,
      title: defaultTitle("weekly", "team_spirit", gameDay, data.season.name),
      gameDay,
      opensAt: new Date(now.getTime() - 86_400_000),
      closesAt: new Date(now.getTime() + 7 * 86_400_000),
    },
  ];

  // A few standouts from the day's teams draw most of the MVP votes.
  const onTheDay = players.filter((p) => played.has(p.teamSeasonId));
  const stars = random.shuffle(onTheDay).slice(0, 4);
  const demoTeam = data.teamSeasons[0]?.id;
  const teams = [...played] as TeamSeasonId[];
  const votes = players.flatMap((voter) => {
    const rows = [];
    if (played.has(voter.teamSeasonId) && random.next() < 0.7) {
      const choices = stars.filter((s) => s.userId !== voter.userId);
      const pick = choices[Math.min(random.int(0, 5), choices.length - 1)];
      if (pick)
        rows.push({
          awardPollId: pollId(1),
          voterId: voter.userId,
          nomineeUserId: pick.userId,
          castAt: new Date(dayAfter.getTime() + random.int(1, 60) * 3_600_000),
        });
    }
    // Other teams have started on the open polls; the demo team has not.
    if (voter.teamSeasonId !== demoTeam && random.next() < 0.4) {
      const other = random.pick(teams.filter((t) => t !== voter.teamSeasonId));
      rows.push({
        awardPollId: pollId(3),
        voterId: voter.userId,
        nomineeTeamSeasonId: other,
        castAt: new Date(now.getTime() - random.int(1, 20) * 3_600_000),
      });
    }
    return rows;
  });
  return { polls, votes };
}

export async function addSeedAwards(
  db: Db,
  data: SeedData,
  now: Date,
): Promise<void> {
  const { polls, votes } = seedAwardRows(data, now);
  await db.insert(awardPoll).values(polls);
  if (votes.length) await db.insert(awardVote).values(votes);
}
