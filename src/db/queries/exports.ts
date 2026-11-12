import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { SeasonId, TeamSeasonId, UserId } from "@/domain/ids";
import { centsToAmount, type Column } from "@/domain/export/csv";
import { user } from "../schema/auth";
import { payment, purchase, purchaseItem } from "../schema/money";
import { profile } from "../schema/profile";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import type { Db } from "./schedule";

/**
 * Rows for the roster and payment CSV files (product-spec.md, section 6:
 * "CSV export of rosters, payments and shirt sizes"). An admin gets the whole
 * season; a captain passes their own team. The route checks the permission;
 * these only read.
 */

const ROLE_LABEL = {
  captain: "Captain",
  co_captain: "Co-captain",
  player: "Player",
} as const;

const fullName = (
  first: string | null,
  last: string | null,
  fallback: string,
) => (first && last ? `${first} ${last}` : fallback);

export type RosterExportRow = {
  team: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  registrationStatus: string;
  waiverSigned: boolean;
  paid: boolean;
  shirtSize: string | null;
  shirtStatus: string;
};

/**
 * Everyone registered for the season, or on one team. Free agents appear in
 * the season file with no team. Cancelled registrations are left out.
 */
export async function rosterExport(
  db: Db,
  seasonId: SeasonId,
  teamSeasonId: TeamSeasonId | null,
): Promise<RosterExportRow[]> {
  const spots = await db
    .select({
      registrationId: rosterMembership.registrationId,
      teamSeasonId: rosterMembership.teamSeasonId,
      teamName: team.name,
      role: rosterMembership.role,
    })
    .from(rosterMembership)
    .innerJoin(teamSeason, eq(rosterMembership.teamSeasonId, teamSeason.id))
    .innerJoin(team, eq(teamSeason.teamId, team.id))
    .where(
      and(
        eq(teamSeason.seasonId, seasonId),
        eq(rosterMembership.status, "active"),
        teamSeasonId ? eq(teamSeason.id, teamSeasonId) : undefined,
      ),
    );
  const spotOf = new Map(spots.map((s) => [s.registrationId, s]));
  const people = await db
    .select({
      registrationId: registration.id,
      status: registration.status,
      waiverSignatureId: registration.waiverSignatureId,
      shirtStatus: registration.shirtStatus,
      email: user.email,
      accountName: user.name,
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phoneE164,
      shirtSize: profile.shirtSize,
    })
    .from(registration)
    .innerJoin(user, eq(registration.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(
      and(
        eq(registration.seasonId, seasonId),
        ne(registration.status, "cancelled"),
      ),
    );
  const order = { captain: 0, co_captain: 1, player: 2 } as const;
  return people
    .filter((p) => (teamSeasonId ? spotOf.has(p.registrationId) : true))
    .map((p) => {
      const spot = spotOf.get(p.registrationId);
      return {
        sortRole: spot ? order[spot.role] : 3,
        row: {
          team: spot?.teamName ?? "",
          name: fullName(p.firstName, p.lastName, p.accountName || p.email),
          email: p.email,
          phone: p.phone,
          role: spot ? ROLE_LABEL[spot.role] : "Free agent",
          registrationStatus: p.status,
          waiverSigned:
            p.waiverSignatureId !== null || p.status !== "pending_waiver",
          paid: p.status === "active",
          shirtSize: p.shirtSize?.toUpperCase() ?? null,
          shirtStatus: p.shirtStatus,
        },
      };
    })
    .sort(
      (a, b) =>
        // Teams first, free agents last.
        Number(a.row.team === "") - Number(b.row.team === "") ||
        a.row.team.localeCompare(b.row.team) ||
        a.sortRole - b.sortRole ||
        a.row.name.localeCompare(b.row.name),
    )
    .map((r) => r.row);
}

export const ROSTER_COLUMNS: readonly Column<RosterExportRow>[] = [
  { header: "Team", value: (r) => r.team },
  { header: "Name", value: (r) => r.name },
  { header: "Email", value: (r) => r.email },
  { header: "Phone", value: (r) => r.phone },
  { header: "Role", value: (r) => r.role },
  { header: "Registration status", value: (r) => r.registrationStatus },
  { header: "Waiver signed", value: (r) => r.waiverSigned },
  { header: "Paid", value: (r) => r.paid },
  { header: "Shirt size", value: (r) => r.shirtSize },
  { header: "Shirt status", value: (r) => r.shirtStatus },
];

export type PaymentExportRow = {
  paidAt: Date | null;
  payer: string;
  payerEmail: string;
  team: string;
  items: string;
  method: string;
  amountCents: number;
  status: string;
  note: string | null;
  recordedBy: string | null;
};

/**
 * Every payment for the season, or the payments that paid for one team's
 * fees and shares. One row per payment, oldest first.
 */
export async function paymentsExport(
  db: Db,
  seasonId: SeasonId,
  teamSeasonId: TeamSeasonId | null,
): Promise<PaymentExportRow[]> {
  const items = await db
    .select({
      purchaseId: purchaseItem.purchaseId,
      teamSeasonId: purchaseItem.teamSeasonId,
      teamName: team.name,
      description: purchaseItem.description,
    })
    .from(purchaseItem)
    .innerJoin(purchase, eq(purchaseItem.purchaseId, purchase.id))
    .leftJoin(teamSeason, eq(purchaseItem.teamSeasonId, teamSeason.id))
    .leftJoin(team, eq(teamSeason.teamId, team.id))
    .where(eq(purchase.seasonId, seasonId))
    .orderBy(asc(purchaseItem.description));
  const purchaseIds = [
    ...new Set(
      items
        .filter((i) => !teamSeasonId || i.teamSeasonId === teamSeasonId)
        .map((i) => i.purchaseId),
    ),
  ];
  if (purchaseIds.length === 0) return [];
  const payments = await db
    .select({
      purchaseId: payment.purchaseId,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      method: payment.method,
      amountCents: payment.amountCents,
      status: payment.status,
      note: payment.note,
      recordedBy: payment.recordedBy,
      payerEmail: user.email,
      payerAccountName: user.name,
      payerFirst: profile.firstName,
      payerLast: profile.lastName,
    })
    .from(payment)
    .innerJoin(purchase, eq(payment.purchaseId, purchase.id))
    .innerJoin(user, eq(purchase.userId, user.id))
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(inArray(payment.purchaseId, purchaseIds))
    .orderBy(asc(payment.createdAt));
  const recorderIds = [
    ...new Set(payments.flatMap((p) => (p.recordedBy ? [p.recordedBy] : []))),
  ];
  const recorders = recorderIds.length
    ? await db
        .select({
          id: user.id,
          accountName: user.name,
          firstName: profile.firstName,
          lastName: profile.lastName,
        })
        .from(user)
        .leftJoin(profile, eq(profile.userId, user.id))
        .where(inArray(user.id, recorderIds))
    : [];
  const recorderName = new Map<UserId, string>(
    recorders.map((r) => [
      r.id,
      fullName(r.firstName, r.lastName, r.accountName),
    ]),
  );
  return payments.map((p) => {
    const mine = items.filter((i) => i.purchaseId === p.purchaseId);
    return {
      paidAt: p.paidAt ?? p.createdAt,
      payer: fullName(
        p.payerFirst,
        p.payerLast,
        p.payerAccountName || p.payerEmail,
      ),
      payerEmail: p.payerEmail,
      team: [...new Set(mine.flatMap((i) => (i.teamName ? [i.teamName] : [])))]
        .sort()
        .join("; "),
      items: mine.map((i) => i.description).join("; "),
      method: p.method,
      amountCents: p.amountCents,
      status: p.status,
      note: p.note,
      recordedBy: p.recordedBy
        ? (recorderName.get(p.recordedBy) ?? null)
        : null,
    };
  });
}

export const PAYMENT_COLUMNS: readonly Column<PaymentExportRow>[] = [
  { header: "Paid at", value: (r) => r.paidAt },
  { header: "Payer", value: (r) => r.payer },
  { header: "Payer email", value: (r) => r.payerEmail },
  { header: "Team", value: (r) => r.team },
  { header: "For", value: (r) => r.items },
  { header: "Method", value: (r) => r.method },
  { header: "Amount", value: (r) => centsToAmount(r.amountCents) },
  { header: "Status", value: (r) => r.status },
  { header: "Note", value: (r) => r.note },
  { header: "Recorded by", value: (r) => r.recordedBy },
];

/**
 * Notes who downloaded which file, since the files carry contact details.
 * The audit row records the scope and row count, never the rows themselves.
 */
export async function recordExport(
  db: Db,
  input: {
    actorId: UserId;
    action: "roster.export" | "payments.export";
    seasonId: SeasonId;
    teamSeasonId: TeamSeasonId | null;
    rows: number;
  },
): Promise<void> {
  await recordAudit(db, {
    actorId: input.actorId,
    action: input.action,
    entityType: input.teamSeasonId ? "team_season" : "season",
    entityId: input.teamSeasonId ?? input.seasonId,
    after: { seasonId: input.seasonId, rows: input.rows },
  });
}
