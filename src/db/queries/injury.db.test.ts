import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import type { NewInjury } from "@/domain/discipline/injury";
import { REMOVED_TEXT } from "@/domain/discipline/injury";
import type { IncidentId, UserId } from "@/domain/ids";
import { err, ok } from "@/domain/result";
import { auditLog } from "../schema/audit";
import { insuranceCertificate } from "../schema/books";
import {
  incident,
  incidentNote,
  incidentPerson,
  injuryReport,
  injuryWitness,
} from "../schema/discipline";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { grantRole, subjectIn } from "../test/leagues";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import { addIncidentNote, fileIncident } from "./discipline";
import {
  exportInjury,
  injuryOf,
  recordInjuryView,
  removeExpiredInjuries,
  removeInjuryDetails,
} from "./injury";
import type { Db } from "./schedule";

afterAll(closePool);

const NOW = new Date("2026-09-15T16:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);
const yearsAgo = (n: number) => {
  const d = new Date(NOW);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d;
};

/**
 * Aces vs Bees that ended two hours ago, reffed by the ref, with an admin
 * and an owner of the league.
 */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const ref = await w.person("ref");
  const admin = await w.person("admin");
  const owner = await w.person("owner");
  const everyone = [
    w.aces.captain,
    ...w.aces.players,
    w.bees.captain,
    ...w.bees.players,
    w.freeAgent,
    ref,
    admin,
    owner,
  ];
  await db.insert(profile).values(
    everyone.map((p, i) => ({
      userId: p.userId,
      firstName: `Pat${i}`,
      lastName: "Example",
    })),
  );
  await grantRole(db, admin.userId, "admin");
  await grantRole(db, owner.userId, "owner");
  const played = await w.gameEnding(hours(-2), ref.userId);
  const hurt = w.aces.players[0]!;
  const witnessA = w.aces.players[1]!;
  const witnessB = w.bees.players[0]!;
  const injury = (over: Partial<NewInjury> = {}): NewInjury => ({
    hurt: hurt.userId,
    bodyArea: "knee",
    care: "first_aid",
    details: "Slid into second and twisted the knee.",
    witnesses: [witnessA.userId, witnessB.userId],
    ...over,
  });
  const file = (
    over: Partial<NewInjury> = {},
    opts: { by?: UserId; role?: "referee" | "admin"; at?: Date } = {},
  ) =>
    fileIncident(db, {
      gameId: played.gameId,
      reportedBy: opts.by ?? ref.userId,
      role: opts.role ?? "referee",
      incident: {
        kind: "injury",
        details: injury(over).details,
        people: [],
        parkRule: null,
      },
      injury: injury(over),
      now: opts.at ?? NOW,
    });
  return { ...w, ref, admin, owner, played, hurt, witnessA, witnessB, file };
}

const filed = (r: { ok: true; value: IncidentId } | { ok: false }) => {
  if (!r.ok) throw new Error("Expected the report to be filed");
  return r.value;
};

describe("filing an injury report", () => {
  it("stores it with the incident, names no one as disciplined, and tells owners and admins only that a report was filed", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = filed(await w.file());

      const [row] = await db.select().from(incident).where(eq(incident.id, id));
      expect(row?.kind).toBe("injury");
      expect(row?.reporterRole).toBe("referee");
      const view = await injuryOf(db, id);
      expect(view).toMatchObject({
        bodyArea: "knee",
        care: "first_aid",
      });
      expect(view?.witnesses).toHaveLength(2);
      // Nobody is "involved" in the conduct sense, so nobody can be suspended.
      expect(
        await db
          .select()
          .from(incidentPerson)
          .where(eq(incidentPerson.incidentId, id)),
      ).toEqual([]);

      // The audit row says a report was filed, and nothing about the injury.
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "incident.file"), eq(auditLog.entityId, id)),
        );
      const written = JSON.stringify(audit);
      for (const secret of ["knee", "first_aid", w.hurt.userId, "twisted"])
        expect(written).not.toContain(secret);

      // One generic message each to the owner and the admin, not the ref.
      const sent = await db
        .select()
        .from(message)
        .where(eq(message.template, "incident_filed"));
      expect(sent.map((m) => m.userId).sort()).toEqual(
        [w.admin.userId, w.owner.userId].sort(),
      );
      for (const m of sent) {
        expect(m.topic).toBe("operations");
        const text = JSON.stringify(m.payload);
        expect(text).toContain("Aces vs Bees");
        expect(text).not.toMatch(
          /injur|knee|first_aid|twisted|Pat|hurt|ambulance/i,
        );
      }
    });
  });

  it("doesn't message the admin who filed it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      filed(await w.file({}, { by: w.admin.userId, role: "admin" }));
      const sent = await db
        .select()
        .from(message)
        .where(eq(message.template, "incident_filed"));
      expect(sent.map((m) => m.userId)).toEqual([w.owner.userId]);
    });
  });

  it("refuses a person who isn't one of the game's players, and writes nothing", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const over of [
        { hurt: w.ref.userId },
        { witnesses: [w.freeAgent.userId] },
      ]) {
        expect(await w.file(over)).toEqual(err("unknown_person"));
      }
      expect(await db.select().from(incident)).toEqual([]);
      expect(await db.select().from(injuryReport)).toEqual([]);
      expect(await db.select().from(message)).toEqual([]);
    });
  });

  it("opens at kickoff like any incident", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const early = await w.gameEnding(hours(30), w.ref.userId);
      const result = await fileIncident(db, {
        gameId: early.gameId,
        reportedBy: w.ref.userId,
        role: "referee",
        incident: {
          kind: "injury",
          details: "x",
          people: [],
          parkRule: null,
        },
        injury: {
          hurt: w.hurt.userId,
          bodyArea: "head",
          care: "none",
          details: "x",
          witnesses: [],
        },
        now: NOW,
      });
      expect(result).toEqual(err("not_started"));
    });
  });
});

describe("who may read an injury report", () => {
  it("is for owners and admins; the ref, captains and players who filed or were hurt can't", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      for (const [who, reads] of [
        [w.admin, true],
        [w.owner, true],
        [w.ref, false],
        [w.aces.captain, false],
        [w.hurt, false],
        [w.witnessA, false],
        [w.freeAgent, false],
      ] as const) {
        const s = await subjectIn(db, who.userId);
        expect(can(s, "injury.read")).toBe(reads);
        expect(can(s, "injury.delete")).toBe(reads);
      }
    });
  });

  it("writes an audit row for every view", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = filed(await w.file());
      await recordInjuryView(db, { incidentId: id, actorId: w.admin.userId });
      await recordInjuryView(db, { incidentId: id, actorId: w.owner.userId });
      const views = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "injury.view"), eq(auditLog.entityId, id)),
        );
      expect(views.map((v) => v.actorId).sort()).toEqual(
        [w.admin.userId, w.owner.userId].sort(),
      );
    });
  });
});

describe("the insurance export", () => {
  it("carries the certificate in force on the game's day, with its dates, and is audited", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = filed(await w.file());
      await addIncidentNote(db, {
        incidentId: id,
        authorId: w.admin.userId,
        body: "Called to check in.",
        now: hours(26),
      });
      await db.insert(insuranceCertificate).values([
        {
          leagueId: w.leagueId,
          insurer: "Park Mutual",
          policyNumber: "PM-1",
          startsOn: "2025-01-01",
          expiresOn: "2025-12-31",
        },
        {
          leagueId: w.leagueId,
          insurer: "Park Mutual",
          policyNumber: "PM-2",
          startsOn: "2026-01-01",
          expiresOn: "2026-12-31",
        },
      ]);
      const report = await exportInjury(db, {
        incidentId: id,
        actorId: w.admin.userId,
      });
      expect(report).toMatchObject({
        matchup: "Aces vs Bees",
        bodyArea: "knee",
        care: "first_aid",
        witnesses: expect.any(Array),
        insurance: {
          covers: true,
          certificate: { policyNumber: "PM-2", expiresOn: "2026-12-31" },
        },
      });
      expect(report?.followUp.map((n) => n.body)).toEqual([
        "Called to check in.",
      ]);
      const exports = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "injury.export"), eq(auditLog.entityId, id)),
        );
      expect(exports).toHaveLength(1);
      expect(exports[0]?.actorId).toBe(w.admin.userId);
    });
  });

  it("says when no certificate is on file, and refuses what isn't an injury", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = filed(await w.file());
      expect(
        (await exportInjury(db, { incidentId: id, actorId: w.admin.userId }))
          ?.insurance,
      ).toBeNull();
      const conduct = filed(
        await fileIncident(db, {
          gameId: w.played.gameId,
          reportedBy: w.ref.userId,
          role: "referee",
          incident: { kind: "ejection", details: "Ejected.", people: [] },
          now: NOW,
        }),
      );
      expect(
        await exportInjury(db, {
          incidentId: conduct,
          actorId: w.admin.userId,
        }),
      ).toBeNull();
    });
  });
});

describe("removing the details", () => {
  it("deletes the injury, witnesses, notes and text, keeps the incident, and is audited with who and why", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = filed(await w.file());
      await addIncidentNote(db, {
        incidentId: id,
        authorId: w.admin.userId,
        body: "Follow-up call.",
        now: hours(1),
      });

      expect(
        await removeInjuryDetails(db, {
          incidentId: id,
          actorId: w.admin.userId,
          reason: "requested",
        }),
      ).toBe(true);

      expect(await injuryOf(db, id)).toBeNull();
      expect(
        await db
          .select()
          .from(injuryWitness)
          .where(eq(injuryWitness.incidentId, id)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(incidentNote)
          .where(eq(incidentNote.incidentId, id)),
      ).toEqual([]);
      const [row] = await db.select().from(incident).where(eq(incident.id, id));
      expect(row).toMatchObject({ kind: "injury", details: REMOVED_TEXT });
      const [deleted] = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "injury.delete"), eq(auditLog.entityId, id)),
        );
      expect(deleted?.actorId).toBe(w.admin.userId);
      expect(deleted?.after).toEqual({ reason: "requested" });
      // Nothing is left to export or to delete again.
      expect(
        await exportInjury(db, { incidentId: id, actorId: w.admin.userId }),
      ).toBeNull();
      expect(
        await removeInjuryDetails(db, {
          incidentId: id,
          actorId: w.admin.userId,
          reason: "requested",
        }),
      ).toBe(false);
    });
  });

  it("leaves a conduct incident alone", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const conduct = filed(
        await fileIncident(db, {
          gameId: w.played.gameId,
          reportedBy: w.ref.userId,
          role: "referee",
          incident: { kind: "ejection", details: "Ejected.", people: [] },
          now: NOW,
        }),
      );
      expect(
        await removeInjuryDetails(db, {
          incidentId: conduct,
          actorId: w.admin.userId,
          reason: "requested",
        }),
      ).toBe(false);
      const [row] = await db
        .select()
        .from(incident)
        .where(eq(incident.id, conduct));
      expect(row?.details).toBe("Ejected.");
    });
  });
});

describe("the retention period", () => {
  it("removes the details of reports older than three years, once, and no others", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const old = filed(await w.file({}, { at: yearsAgo(4) }));
      const edge = filed(await w.file({}, { at: yearsAgo(3) }));
      const recent = filed(await w.file({}, { at: yearsAgo(1) }));

      expect(await removeExpiredInjuries(db, NOW)).toBe(2);
      expect(await injuryOf(db, old)).toBeNull();
      expect(await injuryOf(db, edge)).toBeNull();
      expect(await injuryOf(db, recent)).not.toBeNull();
      // A second run finds nothing more.
      expect(await removeExpiredInjuries(db, NOW)).toBe(0);

      const removals = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "injury.delete"));
      expect(removals).toHaveLength(2);
      for (const r of removals) {
        expect(r.actorId).toBeNull();
        expect(r.after).toEqual({ reason: "retention" });
      }
    });
  });
});

describe("when a person's account goes", () => {
  it("clears who was hurt and drops the witness, keeping the report", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const id = filed(await w.file());
      expect(await deleteAccount(db, w.hurt.userId, NOW)).toEqual(
        ok(undefined),
      );
      expect(await deleteAccount(db, w.witnessA.userId, NOW)).toEqual(
        ok(undefined),
      );
      const view = await injuryOf(db, id);
      expect(view?.hurtName).toBeNull();
      expect(view?.witnesses).toHaveLength(1);
      expect(view?.bodyArea).toBe("knee");
    });
  });
});

describe("a person's own data export", () => {
  it("leaves out an injury report the person filed, and keeps their conduct reports", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      filed(await w.file());
      const conduct = filed(
        await fileIncident(db, {
          gameId: w.played.gameId,
          reportedBy: w.ref.userId,
          role: "referee",
          incident: { kind: "ejection", details: "Ejected.", people: [] },
          now: NOW,
        }),
      );
      const mine = await personalData(db, w.ref.userId, NOW);
      expect(mine?.discipline.incidentsYouReported.map((i) => i.kind)).toEqual([
        "ejection",
      ]);
      // Nor does the person who was hurt see it in theirs.
      const hurt = await personalData(db, w.hurt.userId, NOW);
      expect(hurt?.discipline.incidentsAboutYou).toEqual([]);
      expect(conduct).toBeTruthy();
    });
  });
});
