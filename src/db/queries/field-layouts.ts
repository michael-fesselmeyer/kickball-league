import { and, asc, eq, gt, gte, inArray, lt } from "drizzle-orm";
import type {
  BooksFileId,
  FieldId,
  GameId,
  LeagueId,
  ScheduleVersionId,
  SeasonId,
  UserId,
} from "@/domain/ids";
import type { FileProblem } from "@/domain/books/files";
import { type LayoutState, layoutState } from "@/domain/fields/layout";
import { err, ok, type Result } from "@/domain/result";
import type { PreparedFile } from "@/lib/books/store-file";
import { booksFile } from "../schema/books";
import { fieldLayout } from "../schema/field-layout";
import { field, game, slot, venue } from "../schema/game";
import { gamePlacement } from "../schema/schedule";
import { volunteerShift, volunteerSignup } from "../schema/volunteer";
import { recordAudit } from "./audit";
import { storeFile } from "./books";
import type { Db } from "./schedule";

/**
 * Field layouts (issue #403): the picture and note for each field, and the
 * checks that every field a schedule uses has one. The image is a books
 * file of kind `layout`, under the same limits as a permit document; unlike
 * a permit document it is not secret, but it is only served to the people
 * who set up and play on the field.
 */

export type FieldLayout = {
  fieldId: FieldId;
  fileId: BooksFileId | null;
  noLayoutNeeded: boolean;
  note: string | null;
  contentType: string | null;
  state: LayoutState;
};

/** The layouts of some fields, keyed by field; a field with none is absent. */
export async function layoutsOf(
  db: Db,
  fieldIds: readonly FieldId[],
): Promise<Map<FieldId, FieldLayout>> {
  const out = new Map<FieldId, FieldLayout>();
  if (fieldIds.length === 0) return out;
  const rows = await db
    .select({
      fieldId: fieldLayout.fieldId,
      fileId: fieldLayout.fileId,
      noLayoutNeeded: fieldLayout.noLayoutNeeded,
      note: fieldLayout.note,
      contentType: booksFile.contentType,
    })
    .from(fieldLayout)
    .leftJoin(booksFile, eq(booksFile.id, fieldLayout.fileId))
    .where(inArray(fieldLayout.fieldId, [...fieldIds]));
  for (const r of rows) out.set(r.fieldId, { ...r, state: layoutState(r) });
  return out;
}

export type SetLayoutInput = {
  leagueId: LeagueId;
  fieldId: FieldId;
  /** A new image or PDF; null keeps the one on file. */
  file: PreparedFile | null;
  /** The admin says the field needs none (ignored when a file comes with it). */
  noLayoutNeeded: boolean;
  note: string | null;
  /** Tests pass a smaller storage cap. */
  cap?: number;
};

/**
 * Saves a field's layout: a new file replaces the old one, which is
 * deleted; "no layout needed" removes the file. A save with neither a file
 * nor "no layout needed" only changes the note, and refuses a field that
 * has no layout to attach it to. Call inside a transaction.
 */
export async function setFieldLayout(
  db: Db,
  input: SetLayoutInput,
  actorId: UserId,
): Promise<Result<null, FileProblem | "no_layout">> {
  const [current] = await db
    .select({
      fileId: fieldLayout.fileId,
      noLayoutNeeded: fieldLayout.noLayoutNeeded,
    })
    .from(fieldLayout)
    .where(eq(fieldLayout.fieldId, input.fieldId))
    .for("update");
  let fileId: BooksFileId | null = current?.fileId ?? null;
  let noLayoutNeeded = current?.noLayoutNeeded ?? false;
  if (input.file) {
    const stored = await storeFile(
      db,
      {
        leagueId: input.leagueId,
        kind: "layout",
        file: input.file,
        cap: input.cap,
      },
      actorId,
    );
    if (!stored.ok) return stored;
    fileId = stored.value;
    noLayoutNeeded = false;
  } else if (input.noLayoutNeeded) {
    fileId = null;
    noLayoutNeeded = true;
  } else if (fileId === null && !noLayoutNeeded && input.note !== null) {
    return err("no_layout");
  }
  await db
    .insert(fieldLayout)
    .values({
      fieldId: input.fieldId,
      fileId,
      noLayoutNeeded,
      note: input.note,
      updatedBy: actorId,
    })
    .onConflictDoUpdate({
      target: fieldLayout.fieldId,
      set: {
        fileId,
        noLayoutNeeded,
        note: input.note,
        updatedBy: actorId,
        updatedAt: new Date(),
      },
    });
  // The replaced file is nothing's now; drop it so it stops counting.
  if (current?.fileId && current.fileId !== fileId)
    await db.delete(booksFile).where(eq(booksFile.id, current.fileId));
  await recordAudit(db, {
    actorId,
    action: "fields.layout_set",
    entityType: "field",
    entityId: input.fieldId,
    before: {
      hadFile: current?.fileId != null,
      noLayoutNeeded: current?.noLayoutNeeded ?? false,
    },
    after: { hasFile: fileId !== null, noLayoutNeeded },
  });
  return ok(null);
}

/** The league's fields with their layout state, for the admin screen. */
export async function fieldsWithLayouts(db: Db, leagueId: LeagueId) {
  const fields = await db
    .select({
      id: field.id,
      name: field.name,
      venueName: venue.name,
    })
    .from(field)
    .innerJoin(venue, eq(venue.id, field.venueId))
    .where(eq(venue.leagueId, leagueId))
    .orderBy(asc(venue.name), asc(field.sortOrder), asc(field.name));
  const layouts = await layoutsOf(
    db,
    fields.map((f) => f.id),
  );
  return fields.map((f) => ({
    ...f,
    layout: layouts.get(f.id) ?? null,
    state: layouts.get(f.id)?.state ?? ("missing" as const),
  }));
}

/**
 * The fields a schedule version uses that still have no layout and no
 * "no layout needed", by venue and field name, for the publish check.
 */
export async function fieldsMissingLayout(
  db: Db,
  versionId: ScheduleVersionId,
): Promise<string[]> {
  const used = await db
    .selectDistinct({
      id: field.id,
      name: field.name,
      venueName: venue.name,
    })
    .from(gamePlacement)
    .innerJoin(slot, eq(slot.id, gamePlacement.slotId))
    .innerJoin(field, eq(field.id, slot.fieldId))
    .innerJoin(venue, eq(venue.id, field.venueId))
    .where(eq(gamePlacement.scheduleVersionId, versionId))
    .orderBy(asc(venue.name), asc(field.name));
  const layouts = await layoutsOf(
    db,
    used.map((f) => f.id),
  );
  return used
    .filter((f) => (layouts.get(f.id)?.state ?? "missing") === "missing")
    .map((f) => `${f.venueName}, ${f.name}`);
}

/** The layout of the field a game is played on, for the game's own screens. */
export async function layoutForGame(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      fieldId: field.id,
      fieldName: field.name,
      fileId: fieldLayout.fileId,
      noLayoutNeeded: fieldLayout.noLayoutNeeded,
      note: fieldLayout.note,
      contentType: booksFile.contentType,
    })
    .from(game)
    .innerJoin(slot, eq(slot.id, game.slotId))
    .innerJoin(field, eq(field.id, slot.fieldId))
    .leftJoin(fieldLayout, eq(fieldLayout.fieldId, field.id))
    .leftJoin(booksFile, eq(booksFile.id, fieldLayout.fileId))
    .where(eq(game.id, gameId));
  return found ?? null;
}

/** The layout file of the field a game is played on. */
export async function layoutFileForGame(db: Db, gameId: GameId) {
  const [found] = await db
    .select({
      contentType: booksFile.contentType,
      bytes: booksFile.bytes,
      sha256: booksFile.sha256,
    })
    .from(game)
    .innerJoin(slot, eq(slot.id, game.slotId))
    .innerJoin(fieldLayout, eq(fieldLayout.fieldId, slot.fieldId))
    .innerJoin(booksFile, eq(booksFile.id, fieldLayout.fileId))
    .where(eq(game.id, gameId));
  return found ?? null;
}

/** Whether a field belongs to a league, for the admin's upload. */
export async function fieldInLeague(
  db: Db,
  leagueId: LeagueId,
  fieldId: FieldId,
): Promise<boolean> {
  const [found] = await db
    .select({ id: field.id })
    .from(field)
    .innerJoin(venue, eq(venue.id, field.venueId))
    .where(and(eq(field.id, fieldId), eq(venue.leagueId, leagueId)));
  return found !== undefined;
}

/** A field's name, venue and layout, for the page set-up crews open. */
export async function fieldLayoutPage(
  db: Db,
  leagueId: LeagueId,
  fieldId: FieldId,
) {
  const [found] = await db
    .select({
      fieldName: field.name,
      venueName: venue.name,
      fileId: fieldLayout.fileId,
      noLayoutNeeded: fieldLayout.noLayoutNeeded,
      note: fieldLayout.note,
      contentType: booksFile.contentType,
    })
    .from(field)
    .innerJoin(venue, eq(venue.id, field.venueId))
    .leftJoin(fieldLayout, eq(fieldLayout.fieldId, field.id))
    .leftJoin(booksFile, eq(booksFile.id, fieldLayout.fileId))
    .where(and(eq(field.id, fieldId), eq(venue.leagueId, leagueId)));
  return found ?? null;
}

/** A field's layout file, if the field is the league's. */
export async function fieldLayoutFile(
  db: Db,
  leagueId: LeagueId,
  fieldId: FieldId,
) {
  const [found] = await db
    .select({
      contentType: booksFile.contentType,
      bytes: booksFile.bytes,
      sha256: booksFile.sha256,
    })
    .from(fieldLayout)
    .innerJoin(booksFile, eq(booksFile.id, fieldLayout.fileId))
    .innerJoin(field, eq(field.id, fieldLayout.fieldId))
    .innerJoin(venue, eq(venue.id, field.venueId))
    .where(and(eq(fieldLayout.fieldId, fieldId), eq(venue.leagueId, leagueId)));
  return found ?? null;
}

/**
 * Whether a member holds a set-up shift that has not ended yet, in the
 * league: the volunteers who may open a field's layout. Admins and the
 * game's ref and captains are checked by the caller.
 */
export async function onSetupShift(
  db: Db,
  userId: UserId,
  leagueId: LeagueId,
  now: Date,
): Promise<boolean> {
  const [found] = await db
    .select({ id: volunteerSignup.id })
    .from(volunteerSignup)
    .innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
    .where(
      and(
        eq(volunteerSignup.userId, userId),
        eq(volunteerShift.leagueId, leagueId),
        eq(volunteerShift.role, "setup"),
        gt(volunteerShift.endsAt, now),
      ),
    )
    .limit(1);
  return found !== undefined;
}

/**
 * The fields a season plays on during a shift, with their layout state:
 * every field that has a slot starting between the shift's start and its
 * end plus a day's tail, which is what a set-up crew prepares.
 */
export async function setupFields(
  db: Db,
  seasonId: SeasonId,
  from: Date,
  to: Date,
) {
  const used = await db
    .selectDistinct({
      id: field.id,
      name: field.name,
      venueName: venue.name,
    })
    .from(slot)
    .innerJoin(field, eq(field.id, slot.fieldId))
    .innerJoin(venue, eq(venue.id, field.venueId))
    .where(
      and(
        eq(slot.seasonId, seasonId),
        eq(slot.status, "open"),
        gte(slot.startsAt, from),
        lt(slot.startsAt, to),
      ),
    )
    .orderBy(asc(venue.name), asc(field.name));
  const layouts = await layoutsOf(
    db,
    used.map((f) => f.id),
  );
  return used.map((f) => ({
    ...f,
    state: layouts.get(f.id)?.state ?? ("missing" as const),
  }));
}
