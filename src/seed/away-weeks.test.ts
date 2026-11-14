import { describe, expect, it } from "vitest";
import { availabilityFor, isWeek } from "@/domain/availability/away";
import { demoPersonaRows } from "./demo-personas";
import { generateSeed } from "./generate";
import { seedAwayWeekRows } from "./away-weeks";

describe("seedAwayWeekRows", () => {
  const data = generateSeed();
  const rows = seedAwayWeekRows(data);

  it("marks one Monday away for some of the demo team's women", () => {
    expect(rows.fall.length).toBeGreaterThan(0);
    const weeks = new Set(rows.fall.map((r) => r.weekStart));
    expect(weeks.size).toBe(1);
    expect([...weeks].every(isWeek)).toBe(true);
  });

  it("leaves that week short of a full lineup", () => {
    const personas = demoPersonaRows(data);
    const team = data.teamSeasons[0];
    const profiles = [...personas.profiles, ...data.profiles];
    const members = [...personas.registrations, ...data.registrations]
      .filter((r) =>
        [...personas.rosterMemberships, ...data.rosterMemberships].some(
          (m) => m.registrationId === r.id && m.teamSeasonId === team?.id,
        ),
      )
      .map((r) => ({
        userId: r.id,
        name: r.id,
        side: profiles.find((p) => p.userId === r.userId)?.lineupGender ?? null,
      }));
    const week = rows.fall[0]?.weekStart ?? "";
    const away = new Map(
      rows.fall.map((r) => [r.registrationId, new Set([week])]),
    );
    expect(availabilityFor(members, away, week).short).toBe(true);
  });

  it("puts the demo player on the team's spring roster", () => {
    expect(rows.springRegistration.seasonId).toBe(data.nextSeason.id);
    expect(rows.springMembership.registrationId).toBe(
      rows.springRegistration.id,
    );
  });
});
