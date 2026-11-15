import { and, asc, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import {
  CHECKLIST_PHASES,
  type ChecklistForm,
  type ChecklistPhase,
  DEFAULT_ITEMS,
  DEFAULT_MOVE_SCRIPT,
  type FieldCheckForm,
  type MoveForm,
} from "@/domain/gameday/checklist";
import type {
  BooksFileId,
  GameChecklistItemId,
  FieldId,
  GameId,
  LeagueId,
  SeasonId,
  TeamSeasonId,
  UserId,
  VolunteerShiftId,
} from "@/domain/ids";
import { ok, type Result } from "@/domain/result";
import { localDay } from "@/domain/schedule/public-game";
import type { FileProblem } from "@/domain/books/files";
import type { PreparedFile } from "@/lib/books/store-file";
import { user } from "../schema/auth";
import { booksFile } from "../schema/books";
import { field, game, slot, venue } from "../schema/game";
import {
  gameChecklistItem,
  gameChecklistTick,
  fieldCheck,
  moveRequest,
} from "../schema/game-day-checklist";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { team, teamSeason } from "../schema/team";
import { volunteerShift, volunteerSignup } from "../schema/volunteer";
import { recordAudit } from "./audit";
import { storeFile } from "./books";
import type { Db } from "./schedule";

/**
 * The game-day checklist (issue #409): a season's items (the defaults until
 * its admins write their own), each team's ticks per game, the set-up
 * lead's log of park users asked to move, and each field's set-up and
 * end-of-day checks.
 */

export type ChecklistItems = Record<
  ChecklistPhase,
  { id: GameChecklistItemId; text: string }[]
>;

/**
 * A season's checklist and move script. A season with no items yet gets
 * the defaults written for it, so every tick names a stored item.
 */
export async function seasonChecklist(
  db: Db,
  seasonId: SeasonId,
): Promise<{ items: ChecklistItems; script: string; custom: boolean }> {
  let rows = await itemsOf(db, seasonId);
  if (rows.length === 0) {
    await db
      .insert(gameChecklistItem)
      .values(
        CHECKLIST_PHASES.flatMap((phase) =>
          DEFAULT_ITEMS[phase].map((text, position) => ({
            seasonId,
            phase,
            text,
            position,
          })),
        ),
      )
      .onConflictDoNothing();
    rows = await itemsOf(db, seasonId);
  }
  const [s] = await db
    .select({ script: season.moveScript })
    .from(season)
    .where(eq(season.id, seasonId));
  const items: ChecklistItems = { before: [], after: [] };
  for (const r of rows) items[r.phase].push({ id: r.id, text: r.text });
  const custom = CHECKLIST_PHASES.some(
    (p) =>
      items[p].length !== DEFAULT_ITEMS[p].length ||
      items[p].some((i, n) => i.text !== DEFAULT_ITEMS[p][n]),
  );
  return {
    items,
    script: s?.script ?? DEFAULT_MOVE_SCRIPT,
    custom: custom || (s?.script ?? null) !== null,
  };
}

function itemsOf(db: Db, seasonId: SeasonId) {
  return db
    .select({
      id: gameChecklistItem.id,
      phase: gameChecklistItem.phase,
      text: gameChecklistItem.text,
    })
    .from(gameChecklistItem)
    .where(eq(gameChecklistItem.seasonId, seasonId))
    .orderBy(asc(gameChecklistItem.phase), asc(gameChecklistItem.position));
}

/**
 * An admin saves a season's checklist. An item whose words stay keeps its
 * ticks; a removed one takes its ticks with it. Audited.
 */
export async function saveChecklist(
  db: Db,
  input: { seasonId: SeasonId; form: ChecklistForm; actorId: UserId },
): Promise<void> {
  const before = await seasonChecklist(db, input.seasonId);
  // Lock the season so two admins saving at once take turns.
  await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.id, input.seasonId))
    .for("update");
  for (const phase of CHECKLIST_PHASES) {
    const kept = new Map(before.items[phase].map((i) => [i.text, i.id]));
    const wanted = input.form.items[phase];
    const removed = before.items[phase]
      .filter((i) => !wanted.includes(i.text))
      .map((i) => i.id);
    if (removed.length > 0)
      await db
        .delete(gameChecklistItem)
        .where(inArray(gameChecklistItem.id, removed));
    for (const [position, text] of wanted.entries()) {
      const id = kept.get(text);
      if (id)
        await db
          .update(gameChecklistItem)
          .set({ position })
          .where(eq(gameChecklistItem.id, id));
      else
        await db
          .insert(gameChecklistItem)
          .values({ seasonId: input.seasonId, phase, text, position });
    }
  }
  await db
    .update(season)
    .set({ moveScript: input.form.script })
    .where(eq(season.id, input.seasonId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "game_checklist.edit",
    entityType: "season",
    entityId: input.seasonId,
    before: {
      before: before.items.before.map((i) => i.text),
      after: before.items.after.map((i) => i.text),
    },
    after: { ...input.form.items, script: input.form.script !== null },
  });
}

/** A game as the checklist screens need it. */
export type ChecklistGame = {
  id: GameId;
  seasonId: SeasonId;
  seasonSlug: string;
  leagueId: LeagueId;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  fieldId: FieldId;
  fieldName: string;
  venueName: string;
  teams: { id: TeamSeasonId; name: string }[];
  teamSeasonIds: readonly [TeamSeasonId, TeamSeasonId];
  /** YYYY-MM-DD in the league's time zone. */
  date: string;
  /** No other game on this field that day ends after this one. */
  lastOnField: boolean;
};

export async function checklistGame(
  db: Db,
  gameId: GameId,
): Promise<ChecklistGame | null> {
  const [g] = await db
    .select({
      id: game.id,
      seasonId: game.seasonId,
      seasonSlug: season.slug,
      leagueId: season.leagueId,
      timeZone: league.timezone,
      teamAId: game.teamAId,
      teamBId: game.teamBId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      fieldId: field.id,
      fieldName: field.name,
      venueName: venue.name,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .innerJoin(season, eq(game.seasonId, season.id))
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        eq(game.id, gameId),
        ne(game.status, "cancelled"),
        eq(slot.status, "open"),
      ),
    );
  if (!g) return null;
  const date = localDay(g.startsAt, g.timeZone);
  const [teams, fields] = await Promise.all([
    db
      .select({ id: teamSeason.id, name: team.name })
      .from(teamSeason)
      .innerJoin(team, eq(teamSeason.teamId, team.id))
      .where(inArray(teamSeason.id, [g.teamAId, g.teamBId])),
    dayFields(db, g.seasonId, date, g.timeZone),
  ]);
  const onField = fields.find((f) => f.fieldId === g.fieldId);
  return {
    id: g.id,
    seasonId: g.seasonId,
    seasonSlug: g.seasonSlug,
    leagueId: g.leagueId,
    timeZone: g.timeZone,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    fieldId: g.fieldId,
    fieldName: g.fieldName,
    venueName: g.venueName,
    teamSeasonIds: [g.teamAId, g.teamBId],
    teams: [g.teamAId, g.teamBId].map((id) => ({
      id,
      name: teams.find((t) => t.id === id)?.name ?? "TBD",
    })),
    date,
    lastOnField: onField?.lastGameId === g.id,
  };
}

/** Which of a team's items are ticked for a game, by item id. */
export async function ticksFor(
  db: Db,
  gameId: GameId,
  teamSeasonIds: readonly TeamSeasonId[],
): Promise<Map<TeamSeasonId, Set<GameChecklistItemId>>> {
  const found = new Map<TeamSeasonId, Set<GameChecklistItemId>>(
    teamSeasonIds.map((t) => [t, new Set()]),
  );
  if (teamSeasonIds.length === 0) return found;
  const rows = await db
    .select({
      teamSeasonId: gameChecklistTick.teamSeasonId,
      itemId: gameChecklistTick.itemId,
    })
    .from(gameChecklistTick)
    .where(
      and(
        eq(gameChecklistTick.gameId, gameId),
        inArray(gameChecklistTick.teamSeasonId, [...teamSeasonIds]),
      ),
    );
  for (const r of rows) found.get(r.teamSeasonId)?.add(r.itemId);
  return found;
}

/**
 * A captain ticks or unticks one item for their team's game. The item must
 * be on the game's season's checklist; ticking twice is harmless.
 */
export async function setTick(
  db: Db,
  input: {
    game: Pick<ChecklistGame, "id" | "seasonId">;
    teamSeasonId: TeamSeasonId;
    itemId: GameChecklistItemId;
    on: boolean;
    actorId: UserId;
    now: Date;
  },
): Promise<"saved" | "not_item"> {
  const [item] = await db
    .select({ id: gameChecklistItem.id })
    .from(gameChecklistItem)
    .where(
      and(
        eq(gameChecklistItem.id, input.itemId),
        eq(gameChecklistItem.seasonId, input.game.seasonId),
      ),
    );
  if (!item) return "not_item";
  if (input.on)
    await db
      .insert(gameChecklistTick)
      .values({
        gameId: input.game.id,
        teamSeasonId: input.teamSeasonId,
        itemId: input.itemId,
        tickedBy: input.actorId,
        tickedAt: input.now,
      })
      .onConflictDoNothing();
  else
    await db
      .delete(gameChecklistTick)
      .where(
        and(
          eq(gameChecklistTick.gameId, input.game.id),
          eq(gameChecklistTick.teamSeasonId, input.teamSeasonId),
          eq(gameChecklistTick.itemId, input.itemId),
        ),
      );
  return "saved";
}

/** A field a season plays on during one game day. */
export type DayField = {
  fieldId: FieldId;
  fieldName: string;
  venueName: string;
  firstStartsAt: Date;
  lastEndsAt: Date;
  /** The day's first game on it, whose permit page the set-up lead opens. */
  firstGameId: GameId;
  /** The day's last game on it, whose page carries the end-of-day check. */
  lastGameId: GameId;
};

/** The fields a season's games use on a date, in order of first start. */
export async function dayFields(
  db: Db,
  seasonId: SeasonId,
  date: string,
  timeZone: string,
): Promise<DayField[]> {
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const until = new Date(from.getTime() + 3 * 86_400_000);
  const rows = await db
    .select({
      gameId: game.id,
      fieldId: field.id,
      fieldName: field.name,
      venueName: venue.name,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    })
    .from(game)
    .innerJoin(slot, eq(game.slotId, slot.id))
    .innerJoin(field, eq(slot.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .where(
      and(
        eq(game.seasonId, seasonId),
        ne(game.status, "cancelled"),
        eq(slot.status, "open"),
        gte(slot.startsAt, from),
        lt(slot.startsAt, until),
      ),
    )
    .orderBy(asc(slot.startsAt));
  const fields = new Map<FieldId, DayField>();
  for (const r of rows) {
    if (localDay(r.startsAt, timeZone) !== date) continue;
    const f = fields.get(r.fieldId);
    if (!f)
      fields.set(r.fieldId, {
        fieldId: r.fieldId,
        fieldName: r.fieldName,
        venueName: r.venueName,
        firstStartsAt: r.startsAt,
        lastEndsAt: r.endsAt,
        firstGameId: r.gameId,
        lastGameId: r.gameId,
      });
    else if (r.endsAt >= f.lastEndsAt) {
      f.lastEndsAt = r.endsAt;
      f.lastGameId = r.gameId;
    }
  }
  return [...fields.values()];
}

/** Whether a person leads set-up for a season on a date (a claimed shift). */
export async function isSetupLead(
  db: Db,
  input: { userId: UserId; seasonId: SeasonId; date: string; timeZone: string },
): Promise<boolean> {
  const shifts = await setupLeadShifts(db, input.userId, input.timeZone);
  return shifts.some(
    (s) => s.seasonId === input.seasonId && s.date === input.date,
  );
}

export type SetupLeadShift = {
  shiftId: VolunteerShiftId;
  seasonId: SeasonId;
  seasonName: string;
  seasonSlug: string;
  leagueId: LeagueId;
  date: string;
  startsAt: Date;
};

/** A person's set-up lead shifts on season game days, soonest first. */
export async function setupLeadShifts(
  db: Db,
  userId: UserId,
  timeZone: string,
  from?: Date,
): Promise<SetupLeadShift[]> {
  const rows = await db
    .select({
      shiftId: volunteerShift.id,
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      leagueId: season.leagueId,
      startsAt: volunteerShift.startsAt,
    })
    .from(volunteerSignup)
    .innerJoin(volunteerShift, eq(volunteerSignup.shiftId, volunteerShift.id))
    .innerJoin(season, eq(volunteerShift.seasonId, season.id))
    .where(
      and(
        eq(volunteerSignup.userId, userId),
        eq(volunteerShift.role, "setup_lead"),
        from ? gte(volunteerShift.endsAt, from) : undefined,
      ),
    )
    .orderBy(asc(volunteerShift.startsAt));
  return rows.map((r) => ({
    ...r,
    date: localDay(r.startsAt, timeZone),
  }));
}

/** The set-up lead asked a group of park users to move. Audited. */
export async function recordMove(
  db: Db,
  input: {
    seasonId: SeasonId;
    fieldId: FieldId;
    form: MoveForm;
    actorId: UserId;
    now: Date;
  },
): Promise<void> {
  const [row] = await db
    .insert(moveRequest)
    .values({
      seasonId: input.seasonId,
      fieldId: input.fieldId,
      outcome: input.form.outcome,
      note: input.form.note,
      askedBy: input.actorId,
      askedAt: input.now,
    })
    .returning({ id: moveRequest.id });
  await recordAudit(db, {
    actorId: input.actorId,
    action: "move_request.record",
    entityType: "season",
    entityId: input.seasonId,
    after: { moveRequestId: row?.id, outcome: input.form.outcome },
  });
}

/**
 * A field's set-up or end-of-day check, replacing any earlier one for the
 * same field, day and kind (and the photo it carried). Audited.
 */
export async function recordFieldCheck(
  db: Db,
  input: {
    seasonId: SeasonId;
    fieldId: FieldId;
    date: string;
    kind: "setup" | "close";
    form: FieldCheckForm;
    /** A new photo; without one, a photo already on the check stays. */
    photo: PreparedFile | null;
    leagueId: LeagueId;
    actorId: UserId;
    now: Date;
    /** Tests pass a smaller storage cap. */
    cap?: number;
  },
): Promise<Result<void, FileProblem>> {
  // Lock the season so two people confirming the same field take turns
  // (a missing row can't be locked).
  await db
    .select({ id: season.id })
    .from(season)
    .where(eq(season.id, input.seasonId))
    .for("update");
  let photoId: BooksFileId | null = null;
  if (input.photo) {
    const stored = await storeFile(
      db,
      {
        leagueId: input.leagueId,
        kind: "field_photo",
        file: input.photo,
        cap: input.cap,
      },
      input.actorId,
    );
    if (!stored.ok) return stored;
    photoId = stored.value;
  }
  const [old] = await db
    .select({ id: fieldCheck.id, photoId: fieldCheck.photoId })
    .from(fieldCheck)
    .where(
      and(
        eq(fieldCheck.fieldId, input.fieldId),
        eq(fieldCheck.date, input.date),
        eq(fieldCheck.kind, input.kind),
      ),
    )
    .for("update");
  photoId ??= old?.photoId ?? null;
  const values = {
    seasonId: input.seasonId,
    status: input.form.status,
    note: input.form.note,
    photoId,
    confirmedBy: input.actorId,
    confirmedAt: input.now,
  };
  if (old)
    await db.update(fieldCheck).set(values).where(eq(fieldCheck.id, old.id));
  else
    await db.insert(fieldCheck).values({
      ...values,
      fieldId: input.fieldId,
      date: input.date,
      kind: input.kind,
    });
  if (old?.photoId && old.photoId !== photoId)
    await db.delete(booksFile).where(eq(booksFile.id, old.photoId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "field_check.record",
    entityType: "season",
    entityId: input.seasonId,
    after: {
      fieldId: input.fieldId,
      date: input.date,
      kind: input.kind,
      status: input.form.status,
      photo: photoId !== null,
    },
  });
  return ok(undefined);
}

export type FieldChecks = Map<
  FieldId,
  {
    setup: { status: "ok" | "problem"; at: Date; note: string | null } | null;
    close: {
      status: "ok" | "problem";
      at: Date;
      note: string | null;
      photoId: BooksFileId | null;
    } | null;
  }
>;

/** A season's field checks on a date, by field. */
export async function fieldChecksOn(
  db: Db,
  seasonId: SeasonId,
  date: string,
): Promise<FieldChecks> {
  const rows = await db
    .select()
    .from(fieldCheck)
    .where(and(eq(fieldCheck.seasonId, seasonId), eq(fieldCheck.date, date)));
  const found: FieldChecks = new Map();
  for (const r of rows) {
    const f = found.get(r.fieldId) ?? { setup: null, close: null };
    if (r.kind === "setup")
      f.setup = { status: r.status, at: r.confirmedAt, note: r.note };
    else
      f.close = {
        status: r.status,
        at: r.confirmedAt,
        note: r.note,
        photoId: r.photoId,
      };
    found.set(r.fieldId, f);
  }
  return found;
}

export type MoveIssue = {
  id: string;
  outcome: "refused" | "complaint";
  note: string | null;
  askedAt: Date;
  askedBy: string | null;
  seasonName: string;
  fieldName: string;
  venueName: string;
};

/**
 * Park users asked to move who refused or complained, newest first, for a
 * league's incidents screen.
 */
export async function moveIssues(
  db: Db,
  leagueId: LeagueId,
  since: Date,
): Promise<MoveIssue[]> {
  const rows = await db
    .select({
      id: moveRequest.id,
      outcome: moveRequest.outcome,
      note: moveRequest.note,
      askedAt: moveRequest.askedAt,
      askedBy: user.name,
      seasonName: season.name,
      fieldName: field.name,
      venueName: venue.name,
    })
    .from(moveRequest)
    .innerJoin(season, eq(moveRequest.seasonId, season.id))
    .innerJoin(field, eq(moveRequest.fieldId, field.id))
    .innerJoin(venue, eq(field.venueId, venue.id))
    .leftJoin(user, eq(moveRequest.askedBy, user.id))
    .where(
      and(
        eq(season.leagueId, leagueId),
        ne(moveRequest.outcome, "fine"),
        gte(moveRequest.askedAt, since),
      ),
    )
    .orderBy(desc(moveRequest.askedAt))
    .limit(50);
  return rows.map((r) => ({
    ...r,
    outcome: r.outcome === "complaint" ? "complaint" : "refused",
  }));
}
