import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { toCsv } from "@/domain/export/csv";
import { auditLog } from "../schema/audit";
import { leagueWorld } from "../test/league-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import {
  PAYMENT_COLUMNS,
  paymentsExport,
  recordExport,
  ROSTER_COLUMNS,
  rosterExport,
} from "./exports";

afterAll(closePool);

const INJECTED = '=HYPERLINK("http://example.test") Kicker';

describe("the roster export", () => {
  it("lists the whole season for an admin, teams first and free agents last", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const rows = await rosterExport(db, w.season.id, null);
      expect(
        rows.map((r) => [r.team, r.name, r.role, r.paid, r.shirtSize]),
      ).toEqual([
        ["Base Invaders", "Jordan Other", "Captain", false, "XL"],
        ["Kick Bottom", "Robin Example", "Captain", false, "M"],
        ["Kick Bottom", INJECTED, "Player", true, "L"],
        ["", "Alex Sample", "Free agent", false, null],
      ]);
      expect(rows[1]?.phone).toBe("+15555550101");
      expect(rows[1]?.email).toBe(w.emails[0]);
    });
  });

  it("lists only one team for its captain", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const rows = await rosterExport(db, w.season.id, w.teamSeasonId);
      expect(rows.map((r) => r.name)).toEqual(["Robin Example", INJECTED]);
    });
  });

  it("writes a CSV where a formula in a name stays text", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const csv = toCsv(
        ROSTER_COLUMNS,
        await rosterExport(db, w.season.id, w.teamSeasonId),
      );
      const lines = csv.replace(/^﻿/, "").split("\r\n");
      expect(lines[0]).toBe(
        "Team,Name,Email,Phone,Role,Registration status,Waiver signed,Paid,Shirt size,Shirt status",
      );
      // The phone number and the formula both get a leading apostrophe.
      expect(lines[1]).toContain(",'+15555550101,");
      expect(lines[2]).toContain(
        `,"'=HYPERLINK(""http://example.test"") Kicker",`,
      );
      expect(csv).not.toMatch(/(^|,|\r\n)"?=/);
    });
  });
});

describe("the payments export", () => {
  it("lists each payment with who paid, for what and who recorded it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      const rows = await paymentsExport(db, w.season.id, null);
      expect(rows).toEqual([
        {
          paidAt: expect.any(Date),
          payer: INJECTED,
          payerEmail: w.emails[1],
          team: "Kick Bottom",
          items: "Spring 2027: Kick Bottom",
          method: "cash",
          amountCents: 4500,
          refundedCents: 0,
          status: "succeeded",
          note: "+1 paid at the field",
          recordedBy: "Robin Example",
        },
      ]);
      const csv = toCsv(PAYMENT_COLUMNS, rows);
      expect(csv).toContain(",45.00,0.00,succeeded,'+1 paid at the field,");
    });
  });

  it("keeps another team's payments out of a captain's file", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      expect(
        await paymentsExport(db, w.season.id, w.teamSeasonId),
      ).toHaveLength(1);
      expect(
        await paymentsExport(db, w.season.id, w.otherTeamSeasonId),
      ).toEqual([]);
    });
  });

  it("records each download in the audit log, without the rows", async () => {
    await inRolledBackDb(async (db) => {
      const w = await leagueWorld(db);
      await recordExport(db, {
        actorId: w.captain,
        action: "payments.export",
        seasonId: w.season.id,
        teamSeasonId: w.teamSeasonId,
        rows: 1,
      });
      const [row] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "payments.export"),
            eq(auditLog.entityId, w.teamSeasonId),
          ),
        );
      expect(row).toMatchObject({
        actorId: w.captain,
        entityType: "team_season",
        after: { seasonId: w.season.id, rows: 1 },
      });
    });
  });
});
