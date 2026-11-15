/**
 * npm run seed: replaces the demo league with fresh, deterministic seed data.
 *
 * Only seed-owned rows are ever deleted: the league with the demo slug and
 * users on the reserved seed email domain, plus the four demo personas
 * (src/seed/demo-personas.ts). Real accounts on the same
 * database are never touched. Everything runs in one transaction.
 */
import { existsSync } from "node:fs";
import { eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import {
  generateSeed,
  SEED_EMAIL_DOMAIN,
  SEED_LEAGUE_SLUG,
} from "../src/seed/generate";
import { addSeedAwards } from "../src/seed/awards";
import { addSeedPicks } from "../src/seed/pickem";
import { addSeedAwayWeeks } from "../src/seed/away-weeks";
import { addDemoPersonas, removeDemoPersonas } from "../src/seed/demo-personas";
import { addSeedDivisions, removeSeedDivisions } from "../src/seed/divisions";
import {
  addDisciplinePlayer,
  removeDisciplinePlayer,
} from "../src/seed/discipline";
import { addKeepOffPerson, removeKeepOffPerson } from "../src/seed/keep-off";
import { addAudienceDemo } from "../src/seed/event-audience";
import { addSeedBooks, removeSeedBooks } from "../src/seed/books";
import {
  addSeedFeePayments,
  addSeedMoneySummary,
  removeSeedMoneySummaries,
} from "../src/seed/money-summary";
import { addSeedEvents, removeSeedEvents } from "../src/seed/events";
import { addSeedFriends } from "../src/seed/friends";
import { addSeedShirtMakers } from "../src/seed/shirt-makers";
import { addSeedTournament } from "../src/seed/tournament";
import { addSeedLineups } from "../src/seed/lineups";
import { addMerchDemo, removeSeedMerch } from "../src/seed/merch";
import { addSeedKits } from "../src/seed/equipment";
import { addTicketDemo, removeSeedTickets } from "../src/seed/tickets";
import { addFreeAgentPool } from "../src/seed/free-agent-pool";
import { removeAccountMerges } from "../src/seed/account-merges";
import { removeMoneyRecords } from "../src/seed/money";
import {
  addInstagramPhotos,
  removeInstagramPhotos,
} from "../src/seed/instagram-photos";
import { addMemberPhotos } from "../src/seed/member-photos";
import {
  addSeedRefereePool,
  removeSeedRefereePayouts,
} from "../src/seed/referee-pool";
import { canSeed } from "../src/seed/guard";
import { addPastSeasons } from "../src/seed/past-seasons";
import { addSeasonCards } from "../src/seed/season-cards";
import { addSeedChecklist } from "../src/seed/checklist";
import { addSeedSponsors, removeSeedSponsors } from "../src/seed/sponsors";
import { addSeedStatAwards } from "../src/seed/stat-awards";
import { addSeedInterest } from "../src/seed/interest";
import { addSeedRules } from "../src/seed/rules";
import {
  addDemoConcerns,
  addDemoGameDay,
  addDemoShirtOrder,
} from "../src/seed/demo-recent";
import { seedPublishedSchedule } from "../src/seed/published-schedule";
import { insertSeedProfiles } from "../src/seed/roles";
import { removeSeedPrivateEvents } from "../src/seed/private-events";
import {
  SECOND_LEAGUE_SLUG,
  addSecondLeague,
  removeSecondLeague,
} from "../src/seed/second-league";

if (!process.env.DATABASE_URL && existsSync(".env.local"))
  process.loadEnvFile(".env.local");

async function main(): Promise<void> {
  const allowed = canSeed(process.env);
  if (!allowed.ok) {
    console.error(allowed.error);
    process.exitCode = 1;
    return;
  }

  const seedArg = process.argv.find((a) => a.startsWith("--seed="));
  const data = generateSeed(
    seedArg ? Number(seedArg.slice("--seed=".length)) : undefined,
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });

  const {
    league,
    season,
    venue,
    field,
    fieldLayout,
    slot,
    game,
    scoreReport,
    scoreResponse,
    scheduleVersion,
    bracket,
    permitWindow,
    blackout,
    teamConstraint,
    team,
    teamSeason,
    registration,
    rosterMembership,
    invite,
    purchase,
    payment,
    refund,
    user,
    waiver,
    waiverSignature,
    friendGroup,
    teamFormationRequest,
    announcement,
  } = schema;

  try {
    await db.transaction(async (tx) => {
      // Seed users: on the seed domain, or with an id the seed assigns (a
      // seed user who deleted their account has an anonymized address).
      const isSeedUser = or(
        like(user.email, `%@${SEED_EMAIL_DOMAIN}`),
        inArray(
          user.id,
          data.users.map((u) => u.id),
        ),
      );
      // Seed users' money and signatures would block deleting them, and
      // their league money (ADR 0048) would block deleting the leagues,
      // so it all goes first.
      const seedUsers = (
        await tx.select({ id: user.id }).from(user).where(isSeedUser)
      ).map((r) => r.id);
      if (seedUsers.length) {
        await removeMoneyRecords(tx, { userIds: seedUsers });
        await removeAccountMerges(tx, seedUsers);
        await tx
          .update(registration)
          .set({ waiverSignatureId: null })
          .where(inArray(registration.userId, seedUsers));
        await tx
          .delete(waiverSignature)
          .where(inArray(waiverSignature.userId, seedUsers));
      }
      // Private events restrict deleting their league, season and organizer.
      const demoLeagueIds = (
        await tx
          .select({ id: league.id })
          .from(league)
          .where(inArray(league.slug, [SEED_LEAGUE_SLUG, SECOND_LEAGUE_SLUG]))
      ).map((r) => r.id);
      await removeSeedPrivateEvents(tx, {
        leagueIds: demoLeagueIds,
        userIds: seedUsers,
      });
      // The second league first: the demo player plays in it too.
      await removeSecondLeague(tx);
      // Remove the previous demo league, children first.
      const old = await tx
        .select({ id: league.id })
        .from(league)
        .where(eq(league.slug, SEED_LEAGUE_SLUG));
      for (const { id: leagueId } of old) {
        // Sponsors hold check-ins by seed users and point at the league.
        await removeSeedSponsors(tx, leagueId);
        // Events first: they can name the league's seasons and teams.
        // Tickets and the money behind them point at events and people.
        await removeSeedTickets(tx, leagueId);
        // Merch orders point at people, teams and purchases.
        await removeSeedMerch(tx, leagueId);
        await removeSeedEvents(tx, leagueId);
        // Expenses hold seasons; the books' files belong to the league.
        await removeSeedBooks(tx, leagueId);
        await removeSeedMoneySummaries(tx, leagueId);
        // Team entries and brackets point at divisions.
        await removeSeedDivisions(tx, leagueId);
        const seasonIds = (
          await tx
            .select({ id: season.id })
            .from(season)
            .where(eq(season.leagueId, leagueId))
        ).map((r) => r.id);
        if (seasonIds.length) {
          // Credit, guarantees and the waitlist point at purchases and teams.
          await removeMoneyRecords(tx, { seasonIds });
          await removeSeedRefereePayouts(tx, seasonIds);
          // Money first: purchases point at registrations and teams.
          const purchaseIds = (
            await tx
              .select({ id: purchase.id })
              .from(purchase)
              .where(inArray(purchase.seasonId, seasonIds))
          ).map((r) => r.id);
          if (purchaseIds.length) {
            // Refunds point at payments.
            await tx
              .delete(refund)
              .where(
                inArray(
                  refund.paymentId,
                  tx
                    .select({ id: payment.id })
                    .from(payment)
                    .where(inArray(payment.purchaseId, purchaseIds)),
                ),
              );
            await tx
              .delete(payment)
              .where(inArray(payment.purchaseId, purchaseIds));
            await tx.delete(purchase).where(inArray(purchase.id, purchaseIds));
          }
          // Brackets first: their matches hold teams, games and slots.
          await tx.delete(bracket).where(inArray(bracket.seasonId, seasonIds));
          // Versions next: their placements hold slots.
          await tx
            .delete(scheduleVersion)
            .where(inArray(scheduleVersion.seasonId, seasonIds));
          const gameIds = (
            await tx
              .select({ id: game.id })
              .from(game)
              .where(inArray(game.seasonId, seasonIds))
          ).map((r) => r.id);
          if (gameIds.length) {
            const reportIds = (
              await tx
                .select({ id: scoreReport.id })
                .from(scoreReport)
                .where(inArray(scoreReport.gameId, gameIds))
            ).map((r) => r.id);
            if (reportIds.length)
              await tx
                .delete(scoreResponse)
                .where(inArray(scoreResponse.scoreReportId, reportIds));
            await tx
              .delete(scoreReport)
              .where(inArray(scoreReport.gameId, gameIds));
          }
          await tx.delete(game).where(inArray(game.seasonId, seasonIds));
          await tx.delete(slot).where(inArray(slot.seasonId, seasonIds));
          await tx
            .delete(permitWindow)
            .where(inArray(permitWindow.seasonId, seasonIds));
          await tx
            .delete(blackout)
            .where(inArray(blackout.seasonId, seasonIds));
          const entryIds = (
            await tx
              .select({ id: teamSeason.id })
              .from(teamSeason)
              .where(inArray(teamSeason.seasonId, seasonIds))
          ).map((r) => r.id);
          if (entryIds.length)
            await tx
              .delete(invite)
              .where(inArray(invite.teamSeasonId, entryIds));
          if (entryIds.length)
            await tx
              .delete(rosterMembership)
              .where(inArray(rosterMembership.teamSeasonId, entryIds));
          if (entryIds.length)
            await tx
              .delete(teamConstraint)
              .where(inArray(teamConstraint.teamSeasonId, entryIds));
          await tx
            .delete(registration)
            .where(inArray(registration.seasonId, seasonIds));
          await tx
            .delete(friendGroup)
            .where(inArray(friendGroup.seasonId, seasonIds));
          await tx
            .delete(waiverSignature)
            .where(inArray(waiverSignature.seasonId, seasonIds));
          // A demo visitor may have asked for a new team or sent an
          // announcement; both hold the season and its teams.
          await tx
            .delete(teamFormationRequest)
            .where(inArray(teamFormationRequest.seasonId, seasonIds));
          await tx
            .delete(announcement)
            .where(inArray(announcement.seasonId, seasonIds));
          await tx
            .delete(teamSeason)
            .where(inArray(teamSeason.seasonId, seasonIds));
          await tx.delete(season).where(inArray(season.id, seasonIds));
        }
        await tx.delete(waiver).where(eq(waiver.leagueId, leagueId));
        await removeInstagramPhotos(tx, leagueId);
        await tx.delete(team).where(eq(team.leagueId, leagueId));
        const venueIds = (
          await tx
            .select({ id: venue.id })
            .from(venue)
            .where(eq(venue.leagueId, leagueId))
        ).map((r) => r.id);
        if (venueIds.length)
          await tx.delete(field).where(inArray(field.venueId, venueIds));
        await tx.delete(venue).where(eq(venue.leagueId, leagueId));
        await tx.delete(league).where(eq(league.id, leagueId));
      }
      // Seed users only (profiles, sessions and accounts cascade).
      await tx.delete(user).where(isSeedUser);
      await removeDemoPersonas(tx);
      await removeDisciplinePlayer(tx);
      await removeKeepOffPerson(tx);

      // The demo league is the default one, at the site's own URLs.
      await tx.update(league).set({ isDefault: false });
      await tx.insert(league).values({ ...data.league, isDefault: true });
      await tx.insert(user).values(data.users);
      await insertSeedProfiles(tx, data.league.id, data.profiles);
      await tx.insert(waiver).values(data.waiver);
      await tx.insert(season).values(data.season);
      await tx.insert(venue).values(data.venue);
      await tx.insert(field).values(data.fields);
      // The demo's fields need no layout, so a schedule can be published
      // (#403); one has a note, to show how a layout reads.
      await tx.insert(fieldLayout).values(
        data.fields.map((f, i) => ({
          fieldId: f.id,
          noLayoutNeeded: true,
          note: i === 0 ? "Cones at the four corners." : null,
        })),
      );
      await tx.insert(team).values(data.teams);
      await tx.insert(teamSeason).values(data.teamSeasons);
      await tx.insert(registration).values(data.registrations);
      await tx.insert(rosterMembership).values(data.rosterMemberships);
      await tx.insert(slot).values(data.slots);
      await tx.insert(game).values(data.games);
      await seedPublishedSchedule(tx, data.season.id);
      await tx.insert(season).values(data.nextSeason);
      await tx.insert(teamSeason).values(data.nextTeamSeasons);
      await tx.insert(permitWindow).values(data.permitWindows);
      await tx.insert(slot).values(data.nextSlots);
      await tx.insert(teamConstraint).values(data.teamConstraints);
      await addDemoPersonas(tx, data);
      await addSecondLeague(tx);
      await addDisciplinePlayer(tx, data);
      await addKeepOffPerson(tx, data);
      await addSeedLineups(tx, data);
      await addSeedAwayWeeks(tx, data);
      await addPastSeasons(tx, data);
      await addSeedDivisions(tx, data);
      await addFreeAgentPool(tx, data);
      await addSeedEvents(tx, data);
      await addSeedTournament(tx, data);
      await addAudienceDemo(tx, data);
      await addTicketDemo(tx, data);
      await addMerchDemo(tx, data);
      await addSeedKits(tx, data);
      await addSeedAwards(tx, data, new Date());
      await addSeedPicks(tx, data);
      await addSeasonCards(tx, data, new Date());
      await addSeedSponsors(tx, data);
      await addInstagramPhotos(tx, data);
      await addSeedBooks(tx, data);
      await addSeedFriends(tx, data);
      await addSeedShirtMakers(tx, data);
      await addSeedFeePayments(tx, data);
      await addMemberPhotos(tx, data);
      await addSeedStatAwards(tx, data, new Date());
      await addSeedRefereePool(tx, data);
      await addSeedChecklist(tx, data, new Date());
      await addSeedRules(tx, data, new Date());
      await addDemoShirtOrder(tx, data, new Date());
      await addDemoConcerns(tx, data, new Date());
      await addDemoGameDay(tx, data);
      await addSeedInterest(tx, data, new Date());
    });
    // After the commit, on the pool: the summary reads its totals in parallel.
    await addSeedMoneySummary(db, data);
    const played = data.games.filter((g) => g.status === "final").length;
    console.info(
      `Seeded "${data.league.name}": ${data.teams.length} teams, ${data.users.length} people, ${data.slots.length} slots, ${data.games.length} games (${played} played), and ${data.nextSeason.name} ready to schedule (${data.nextSlots.length} slots).`,
    );
  } finally {
    await pool.end();
  }
}

/** Runs on import; `npm run demo:reset` waits for it before its last step. */
export const seeding = main();
