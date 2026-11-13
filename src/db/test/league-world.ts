import { eq } from "drizzle-orm";
import type { RegistrationId, UserId } from "@/domain/ids";
import { checkoutItems } from "@/domain/registration/checkout";
import type { Db } from "../queries/schedule";
import { recordOffAppPayment } from "../queries/payments";
import {
  registerFreeAgent,
  registerTeam,
  seasonForRegistration,
} from "../queries/registration";
import { registrationForPayment } from "../queries/registrations-admin";
import { user } from "../schema/auth";
import { league } from "../schema/league";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { registration, rosterMembership } from "../schema/team";

export const NOW = new Date("2027-02-15T17:00:00Z");

type Person = {
  first: string;
  last: string;
  shirt: "xs" | "s" | "m" | "l" | "xl" | "xxl" | null;
  phone: string | null;
};

/**
 * A small invented league for export, shirt and account tests: a team with
 * a captain and a teammate, a second team, a free agent and an admin. Each
 * player pays their own fee; the teammate has paid in cash.
 */
export async function leagueWorld(db: Db) {
  const tag = Math.random().toString(36).slice(2, 8);
  const cast: Person[] = [
    { first: "Robin", last: "Example", shirt: "m", phone: "+15555550101" },
    // A name that would run as a spreadsheet formula if left alone.
    {
      first: '=HYPERLINK("http://example.test")',
      last: "Kicker",
      shirt: "l",
      phone: null,
    },
    { first: "Alex", last: "Sample", shirt: null, phone: null },
    { first: "Casey", last: "Admin", shirt: "s", phone: null },
    { first: "Jordan", last: "Other", shirt: "xl", phone: null },
  ];
  const people = await db
    .insert(user)
    .values(
      cast.map((p, i) => ({
        name: `${p.first} ${p.last}`,
        email: `world-${i}-${tag}@example.test`,
      })),
    )
    .returning({ id: user.id, email: user.email });
  await db.insert(profile).values(
    people.map((p, i) => ({
      userId: p.id,
      firstName: cast[i]?.first ?? null,
      lastName: cast[i]?.last ?? null,
      shirtSize: cast[i]?.shirt ?? null,
      phoneE164: cast[i]?.phone ?? null,
      globalRole: i === 3 ? ("admin" as const) : ("player" as const),
    })),
  );
  const [captain, teammate, agent, admin, otherCaptain] = people.map(
    (p) => p.id,
  ) as [UserId, UserId, UserId, UserId, UserId];

  const [lg] = await db
    .insert(league)
    .values({ name: "Test League", slug: `world-${tag}` })
    .returning({ id: league.id });
  if (!lg) throw new Error("no league");
  await db.insert(season).values({
    leagueId: lg.id,
    name: "Spring 2027",
    slug: "spring-2027",
    status: "registration_open",
    startsOn: "2027-04-05",
    endsOn: "2027-06-28",
    feeModel: "per_player",
    playerFeeCents: 4500,
    freeAgentFeeCents: 4500,
    rosterMin: 1,
    rosterMax: 20,
  });
  const s = await seasonForRegistration(db, lg.id, "spring-2027");
  if (!s) throw new Error("no season");

  const register = async (userId: UserId, name: string) => {
    const result = await registerTeam(db, {
      leagueId: lg.id,
      season: s,
      userId,
      team: {
        teamId: null,
        name,
        colorHex: null,
        paymentMode: "full",
        rosterSize: 10,
      },
      now: NOW,
    });
    if (!result.ok) throw new Error(result.error);
    return result.value.teamSeasonId;
  };
  const teamSeasonId = await register(captain, "Kick Bottom");
  const otherTeamSeasonId = await register(otherCaptain, "Base Invaders");

  // The teammate joins the first team and signs the waiver.
  const [joined] = await db
    .insert(registration)
    .values({
      seasonId: s.id,
      userId: teammate,
      kind: "team_member",
      status: "pending_payment",
    })
    .returning({ id: registration.id });
  if (!joined) throw new Error("no registration");
  await db.insert(rosterMembership).values({
    teamSeasonId,
    registrationId: joined.id,
    role: "player",
    status: "active",
    startedAt: NOW,
  });

  const fa = await registerFreeAgent(db, {
    season: s,
    userId: agent,
    now: NOW,
  });
  if (!fa.ok) throw new Error(fa.error);

  // The captain records the teammate's cash.
  const reg = await registrationForPayment(db, s.id, joined.id);
  if (!reg) throw new Error("no registration");
  const items = checkoutItems(s, reg, NOW);
  if (!items.ok) throw new Error(items.error);
  await recordOffAppPayment(db, {
    userId: teammate,
    seasonId: s.id,
    registrationId: joined.id,
    items: items.items,
    method: "cash",
    note: "+1 paid at the field",
    actorId: captain,
    now: NOW,
  });

  const registrationOf = async (userId: UserId): Promise<RegistrationId> => {
    const [row] = await db
      .select({ id: registration.id })
      .from(registration)
      .where(eq(registration.userId, userId));
    if (!row) throw new Error("no registration");
    return row.id;
  };

  return {
    leagueId: lg.id,
    season: s,
    emails: people.map((p) => p.email),
    captain,
    teammate,
    agent,
    admin,
    otherCaptain,
    teamSeasonId,
    otherTeamSeasonId,
    teammateRegistration: joined.id,
    agentRegistration: fa.value,
    registrationOf,
  };
}
