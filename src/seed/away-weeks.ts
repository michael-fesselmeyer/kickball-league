import type { Db } from "@/db/queries/schedule";
import { awayWeek, registration, rosterMembership } from "@/db/schema";
import { weekOf } from "@/domain/availability/away";
import type { RegistrationId, RosterMembershipId } from "@/domain/ids";
import { localDate } from "@/domain/scheduler/slots";
import { demoPersonaRows } from "./demo-personas";
import { type SeedData } from "./generate";

/**
 * Away weeks for the demo captain's team (src/seed/demo-personas.ts):
 * - In the fall, every woman but four is away the week of the team's last
 *   game, so the captain sees that week short of a full lineup in the
 *   kicking-order builder, with who is away.
 * - Pat Player is also on the team's Spring 2027 roster, whose weeks are
 *   still to come, so a demo visitor can mark one away on the profile.
 * Fixed ids in their own range, so the generated league's ids stay the
 * same.
 */
const rowId = <T extends string>(n: number) =>
  `a7a70000-0000-4000-8000-${String(n).padStart(12, "0")}` as T;

export function seedAwayWeekRows(data: SeedData) {
  const personas = demoPersonaRows(data);
  const team = data.teamSeasons[0];
  const spring = data.nextTeamSeasons.find((t) => t.teamId === team?.teamId);
  const player = personas.registrations[1];
  if (!team || !spring || !player)
    throw new Error("The seed has no demo team or player");
  const last = data.games
    .filter((g) => g.teamAId === team.id || g.teamBId === team.id)
    .sort((a, b) => b.roundNo - a.roundNo)[0];
  const slot = data.slots.find((s) => s.id === last?.slotId);
  if (!slot) throw new Error("The demo team has no last game");
  const week = weekOf(localDate(slot.startsAt, data.league.timezone));

  const profiles = [...personas.profiles, ...data.profiles];
  const women = [...personas.registrations, ...data.registrations].filter(
    (r) =>
      [...personas.rosterMemberships, ...data.rosterMemberships].some(
        (m) => m.registrationId === r.id && m.teamSeasonId === team.id,
      ) &&
      profiles.find((p) => p.userId === r.userId)?.lineupGender === "woman",
  );
  return {
    fall: women.slice(4).map((r) => ({
      registrationId: r.id,
      weekStart: week,
    })),
    springRegistration: {
      id: rowId<RegistrationId>(1),
      seasonId: data.nextSeason.id,
      userId: player.userId,
      kind: "team_member" as const,
      status: "active" as const,
    },
    springMembership: {
      id: rowId<RosterMembershipId>(2),
      teamSeasonId: spring.id,
      registrationId: rowId<RegistrationId>(1),
      role: "player" as const,
      status: "active" as const,
      startedAt: new Date("2027-01-10T16:00:00Z"),
      sharesContact: true,
    },
  };
}

/** Adds the demo away weeks, after the personas. */
export async function addSeedAwayWeeks(db: Db, data: SeedData): Promise<void> {
  const rows = seedAwayWeekRows(data);
  if (rows.fall.length > 0) await db.insert(awayWeek).values(rows.fall);
  await db.insert(registration).values(rows.springRegistration);
  await db.insert(rosterMembership).values(rows.springMembership);
}
