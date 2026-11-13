import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { can } from "@/domain/authz/permissions";
import type { TeamSeasonId, UserId } from "@/domain/ids";
import { suggestPlacements } from "@/domain/matcher/matcher";
import { err, ok } from "@/domain/result";
import { auditLog } from "../schema/audit";
import { teamKeepOff } from "../schema/keep-off";
import { league } from "../schema/league";
import { message } from "../schema/message";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import { rosterMembership } from "../schema/team";
import { messagingWorld } from "../test/messaging-world";
import { closePool, inRolledBackDb } from "../test/transaction";
import { deleteAccount, personalData } from "./account";
import { matcherInput, placeTogether } from "./free-agents";
import { acceptInvite, createTeamInvite, inviteByToken } from "./invites";
import {
  addKeepOff,
  isKeptOff,
  leagueKeepOffs,
  removeKeepOff,
  setExportKeepOffEntries,
  teamKeepOffList,
  teamOfSeason,
} from "./keep-off";
import { placeFreeAgent } from "./registrations-admin";
import type { Db } from "./schedule";
import { loadSubject } from "./subject";
import { claimSubSpot, postSubRequest, subRequestsFor } from "./subs";

afterAll(closePool);

const NOW = new Date("2026-09-14T12:00:00Z");
const LATER = new Date("2026-09-14T20:00:00Z");

/** The messaging world, with Aces' captain keeping the free agent off. */
async function world(db: Db) {
  const w = await messagingWorld(db);
  const aces = await teamOfSeason(db, w.aces.id);
  const bees = await teamOfSeason(db, w.bees.id);
  if (!aces || !bees) throw new Error("Expected the teams");
  const listed = await addKeepOff(db, {
    teamId: aces.teamId,
    email: w.freeAgent.email.toUpperCase(),
    reason: "Too rough at second base",
    actorId: w.aces.captain.userId,
    now: NOW,
  });
  if (!listed.ok) throw new Error(listed.error);
  return { ...w, acesTeamId: aces.teamId, beesTeamId: bees.teamId };
}

const actionsOn = (db: Db, prefix: string) =>
  db
    .select({
      action: auditLog.action,
      entityId: auditLog.entityId,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(like(auditLog.action, `${prefix}%`));

describe("a team's not-on-my-team list", () => {
  it("adds by email address, keeps the reason private to the list, and audits without it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const list = await teamKeepOffList(db, w.aces.id);
      expect(list).toMatchObject([
        {
          userId: w.freeAgent.userId,
          email: w.freeAgent.email,
          reason: "Too rough at second base",
        },
      ]);
      expect(await isKeptOff(db, w.aces.id, w.freeAgent.userId)).toBe(true);
      expect(await isKeptOff(db, w.bees.id, w.freeAgent.userId)).toBe(false);
      const audit = await actionsOn(db, "keep_off.");
      expect(audit).toEqual([
        {
          action: "keep_off.add",
          entityId: w.acesTeamId,
          after: { userId: w.freeAgent.userId, withReason: true },
        },
      ]);
      expect(JSON.stringify(audit)).not.toContain("second base");
    });
  });

  it("refuses an unknown address, the captain themselves, a teammate and a repeat", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const add = (email: string) =>
        addKeepOff(db, {
          teamId: w.acesTeamId,
          email,
          reason: null,
          actorId: w.aces.captain.userId,
          now: NOW,
        });
      expect(await add("nobody-here@example.test")).toEqual(err("not_found"));
      expect(await add(w.aces.captain.email)).toEqual(err("self"));
      expect(await add(w.aces.players[0]!.email)).toEqual(err("on_team"));
      expect(await add(w.freeAgent.email)).toEqual(err("already_listed"));
    });
  });

  it("removes an entry only through its own team, and audits it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const [entry] = await teamKeepOffList(db, w.aces.id);
      const id = entry!.id;
      // Another team's captain can't reach it through their own team.
      expect(
        await removeKeepOff(db, {
          id,
          teamId: w.beesTeamId,
          actorId: w.bees.captain.userId,
        }),
      ).toEqual(err("not_found"));
      expect(
        await removeKeepOff(db, {
          id,
          teamId: w.acesTeamId,
          actorId: w.aces.captain.userId,
        }),
      ).toEqual(ok(undefined));
      expect(await teamKeepOffList(db, w.aces.id)).toEqual([]);
      expect((await actionsOn(db, "keep_off.remove")).length).toBe(1);
    });
  });

  it("lets captains and admins manage it, and never a player", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      // Only people with a profile are signed-in subjects.
      const people = [
        w.aces.players[0]!,
        w.freeAgent,
        w.aces.captain,
        w.bees.captain,
      ];
      await db
        .insert(profile)
        .values(people.map((p) => ({ userId: p.userId, firstName: "Sam" })));
      const player = await loadSubject(db, w.aces.players[0]!.userId);
      const listedPerson = await loadSubject(db, w.freeAgent.userId);
      const captain = await loadSubject(db, w.aces.captain.userId);
      const otherCaptain = await loadSubject(db, w.bees.captain.userId);
      for (const who of [player, listedPerson, otherCaptain]) {
        expect(can(who, "keep_off.manage", { teamSeasonId: w.aces.id })).toBe(
          false,
        );
        expect(can(who, "keep_off.review")).toBe(false);
      }
      expect(can(captain, "keep_off.manage", { teamSeasonId: w.aces.id })).toBe(
        true,
      );
      expect(can(captain, "keep_off.review")).toBe(false);
    });
  });

  it("shows admins every team's list with who added it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const rows = await leagueKeepOffs(db, w.leagueId);
      expect(rows).toMatchObject([
        {
          teamName: "Aces",
          userId: w.freeAgent.userId,
          reason: "Too rough at second base",
          addedByName: "ace-cap",
        },
      ]);
    });
  });
});

describe("the invite link for someone the team keeps off", () => {
  it("reads and fails exactly like an expired link", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const captain = w.aces.captain.userId;
      // A link that really expired, from long ago, on the Bees.
      const old = await createTeamInvite(db, {
        teamSeasonId: w.bees.id,
        actorId: w.bees.captain.userId,
        now: new Date("2026-01-01T00:00:00Z"),
      });
      const { token } = await createTeamInvite(db, {
        teamSeasonId: w.aces.id,
        actorId: captain,
        now: NOW,
      });
      const listed = w.freeAgent.userId;
      const someoneElse = (await w.person("new-face")).userId;

      const expired = await inviteByToken(db, old.token, NOW, someoneElse);
      const keptOff = await inviteByToken(db, token, NOW, listed);
      expect(expired?.state).toBe("expired");
      expect(keptOff?.state).toBe(expired?.state);
      // Everyone else still sees a working link.
      expect((await inviteByToken(db, token, NOW, someoneElse))?.state).toBe(
        "open",
      );

      const tryExpired = await acceptInvite(db, {
        token: old.token,
        userId: someoneElse,
        now: NOW,
      });
      const tryKeptOff = await acceptInvite(db, {
        token,
        userId: listed,
        now: NOW,
      });
      expect(tryKeptOff).toEqual(tryExpired);
      expect(tryKeptOff).toEqual(err("expired"));
      // Not joined, and nothing was sent to them.
      expect(
        await db
          .select()
          .from(rosterMembership)
          .where(
            eq(rosterMembership.registrationId, w.freeAgent.registrationId),
          ),
      ).toEqual([]);
      expect(
        await db.select().from(message).where(eq(message.userId, listed)),
      ).toEqual([]);
    });
  });
});

describe("the free-agent matcher and placing by hand", () => {
  it("never suggests the team that keeps them off", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const input = await matcherInput(db, w.season.id);
      const acesTeam = input?.teams.find((t) => t.teamSeasonId === w.aces.id);
      expect(acesTeam?.keepOff).toEqual([w.freeAgent.registrationId]);
      const { suggestions } = suggestPlacements(input!.pool, input!.teams);
      const placed = suggestions.find((s) =>
        s.registrationIds.includes(w.freeAgent.registrationId),
      );
      expect(placed?.teamSeasonId).toBe(w.bees.id);
    });
  });

  it("refuses a stale suggestion that puts them on that team", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await placeTogether(db, {
          seasonId: w.season.id,
          registrationIds: [w.freeAgent.registrationId],
          teamSeasonId: w.aces.id,
          actorId: w.aces.captain.userId,
          now: NOW,
        }),
      ).toEqual(err("on_team_list"));
    });
  });

  it("warns an admin placing them by hand, and audits an override", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const admin = (await w.person("admin")).userId;
      const place = (override: boolean, teamSeasonId: TeamSeasonId) =>
        placeFreeAgent(db, {
          seasonId: w.season.id,
          registrationId: w.freeAgent.registrationId,
          teamSeasonId,
          actorId: admin,
          now: NOW,
          override,
        });
      expect(await place(false, w.aces.id)).toEqual(err("on_team_list"));
      expect(await actionsOn(db, "free_agents.")).toEqual([]);
      expect(await place(true, w.aces.id)).toEqual(ok(undefined));
      expect(await actionsOn(db, "keep_off.override")).toEqual([
        {
          action: "keep_off.override",
          entityId: w.freeAgent.registrationId,
          after: { teamSeasonId: w.aces.id },
        },
      ]);
    });
  });

  it("places them on any other team with no warning", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      expect(
        await placeFreeAgent(db, {
          seasonId: w.season.id,
          registrationId: w.freeAgent.registrationId,
          teamSeasonId: w.bees.id,
          actorId: w.bees.captain.userId,
          now: NOW,
        }),
      ).toEqual(ok(undefined));
      expect(await actionsOn(db, "keep_off.override")).toEqual([]);
    });
  });
});

describe("the sub finder", () => {
  async function posted(db: Db, w: Awaited<ReturnType<typeof world>>) {
    const { gameId } = await w.gameEnding(LATER);
    const post = (teamSeasonId: TeamSeasonId, captain: UserId) =>
      postSubRequest(db, {
        gameId,
        teamSeasonId,
        requestedBy: captain,
        spots: { needed: 2, womenNeeded: 0, menNeeded: 0 },
        note: null,
        now: NOW,
      });
    const aces = await post(w.aces.id, w.aces.captain.userId);
    const bees = await post(w.bees.id, w.bees.captain.userId);
    if (!aces.ok || !bees.ok) throw new Error("Expected both requests");
    return { aces: aces.value.id, bees: bees.value.id };
  }

  it("never tells them about the team's request, nor shows it, and refuses a claim on it", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const requests = await posted(db, w);
      const told = await db
        .select({ key: message.dedupeKey })
        .from(message)
        .where(
          and(
            eq(message.userId, w.freeAgent.userId),
            eq(message.template, "sub_request"),
          ),
        );
      expect(told.map((t) => t.key)).toEqual([
        `sub_request/${requests.bees}/${w.freeAgent.userId}`,
      ]);

      const seen = await subRequestsFor(db, w.freeAgent.userId, NOW);
      expect(seen.map((r) => r.id)).toEqual([requests.bees]);
      expect(
        await claimSubSpot(db, {
          requestId: requests.aces,
          userId: w.freeAgent.userId,
          now: NOW,
        }),
      ).toEqual(err("not_found"));
      // The other team's request is theirs to take as usual.
      expect(
        (
          await claimSubSpot(db, {
            requestId: requests.bees,
            userId: w.freeAgent.userId,
            now: NOW,
          })
        ).ok,
      ).toBe(true);
    });
  });

  it("leaves everyone else's view of the request alone", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const requests = await posted(db, w);
      const other = await w.person("other-free", "active");
      const seen = await subRequestsFor(db, other.userId, NOW);
      expect(seen.map((r) => r.id).sort()).toEqual(
        [requests.aces, requests.bees].sort(),
      );
    });
  });
});

describe("data rights", () => {
  it("leaves entries about a person out of their export unless the owners choose", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const before = await personalData(db, w.freeAgent.userId, NOW);
      expect(before?.notOnMyTeamLists).toEqual({ added: [] });
      expect(JSON.stringify(before)).not.toContain("second base");

      await setExportKeepOffEntries(db, {
        leagueId: w.leagueId,
        on: true,
        actorId: w.aces.captain.userId,
      });
      const after = await personalData(db, w.freeAgent.userId, NOW);
      expect(after?.notOnMyTeamLists).toMatchObject({
        added: [],
        aboutYou: [{ team: "Aces", reason: "Too rough at second base" }],
      });
      expect((await actionsOn(db, "keep_off.export_policy")).length).toBe(1);
    });
  });

  it("lists the entries a captain added in the captain's own export", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const mine = await personalData(db, w.aces.captain.userId, NOW);
      expect(mine?.notOnMyTeamLists.added).toMatchObject([
        { team: "Aces", person: "free", reason: "Too rough at second base" },
      ]);
    });
  });

  it("removes the entries when either account is deleted", async () => {
    await inRolledBackDb(async (db) => {
      const w = await world(db);
      const count = async () => (await db.select().from(teamKeepOff)).length;
      // The person listed.
      expect(await count()).toBe(1);
      expect(await deleteAccount(db, w.freeAgent.userId, NOW)).toEqual(
        ok(undefined),
      );
      expect(await count()).toBe(0);

      // The captain who added one, once their season is over.
      const again = await addKeepOff(db, {
        teamId: w.acesTeamId,
        email: w.bees.players[0]!.email,
        reason: null,
        actorId: w.aces.captain.userId,
        now: NOW,
      });
      expect(again.ok).toBe(true);
      await db
        .update(season)
        .set({ status: "completed" })
        .where(eq(season.id, w.season.id));
      expect(await deleteAccount(db, w.aces.captain.userId, NOW)).toEqual(
        ok(undefined),
      );
      expect(await count()).toBe(0);
      // The league setting is untouched.
      const [lg] = await db
        .select({ on: league.exportKeepOffEntries })
        .from(league)
        .where(eq(league.id, w.leagueId));
      expect(lg?.on).toBe(false);
    });
  });
});
