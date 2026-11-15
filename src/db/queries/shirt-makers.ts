import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { LeagueId, ShirtMakerId, UserId } from "@/domain/ids";
import { err, ok, type Result } from "@/domain/result";
import type { MakerFields } from "@/domain/shirts/makers";
import { shirtMaker } from "../schema/shirt-late";
import { recordAudit } from "./audit";
import { required } from "./rows";
import type { Db } from "./schedule";

/**
 * The shirt makers directory (docs/data-model.md, section 2.1): local
 * custom jersey and t-shirt makers an admin curates, shown to captains
 * whose team wears its own shirts. The writes record their audit row in
 * the same transaction; callers run them inside one.
 */

export type Maker = MakerFields & { id: ShirtMakerId; updatedAt: Date };

const COLUMNS = {
  id: shirtMaker.id,
  name: shirtMaker.name,
  url: shirtMaker.url,
  makes: shirtMaker.makes,
  minimumOrder: shirtMaker.minimumOrder,
  updatedAt: shirtMaker.updatedAt,
};

/** Every maker in the league's directory, by name, in one query. */
export async function shirtMakers(
  db: Db,
  leagueId: LeagueId,
): Promise<Maker[]> {
  return db
    .select(COLUMNS)
    .from(shirtMaker)
    .where(eq(shirtMaker.leagueId, leagueId))
    .orderBy(asc(shirtMaker.name));
}

async function makerById(
  db: Db,
  leagueId: LeagueId,
  id: ShirtMakerId,
): Promise<Maker | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(shirtMaker)
    .where(and(eq(shirtMaker.id, id), eq(shirtMaker.leagueId, leagueId)));
  return row ?? null;
}

export type MakerSaveError = "name_taken" | "not_found";

async function nameTaken(
  db: Db,
  leagueId: LeagueId,
  name: string,
  except: ShirtMakerId | null,
): Promise<boolean> {
  const found = await db
    .select({ id: shirtMaker.id })
    .from(shirtMaker)
    .where(
      and(
        eq(shirtMaker.leagueId, leagueId),
        sql`lower(${shirtMaker.name}) = lower(${name})`,
        except ? ne(shirtMaker.id, except) : undefined,
      ),
    );
  return found.length > 0;
}

/** Adds a maker to the directory. */
export async function createMaker(
  db: Db,
  input: { leagueId: LeagueId; fields: MakerFields; actorId: UserId },
): Promise<Result<ShirtMakerId, MakerSaveError>> {
  if (await nameTaken(db, input.leagueId, input.fields.name, null))
    return err("name_taken");
  const created = required(
    (
      await db
        .insert(shirtMaker)
        .values({
          leagueId: input.leagueId,
          ...input.fields,
          createdBy: input.actorId,
        })
        .returning({ id: shirtMaker.id })
    )[0],
    "shirt_maker insert",
  );
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirt_maker.create",
    entityType: "shirt_maker",
    entityId: created.id,
    leagueId: input.leagueId,
    after: input.fields,
  });
  return ok(created.id);
}

const fieldsOf = (m: Maker): MakerFields => ({
  name: m.name,
  url: m.url,
  makes: m.makes,
  minimumOrder: m.minimumOrder,
});

/** Changes a maker's details. */
export async function updateMaker(
  db: Db,
  input: {
    leagueId: LeagueId;
    id: ShirtMakerId;
    fields: MakerFields;
    actorId: UserId;
  },
): Promise<Result<null, MakerSaveError>> {
  const before = await makerById(db, input.leagueId, input.id);
  if (!before) return err("not_found");
  if (await nameTaken(db, input.leagueId, input.fields.name, input.id))
    return err("name_taken");
  await db
    .update(shirtMaker)
    .set(input.fields)
    .where(eq(shirtMaker.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirt_maker.update",
    entityType: "shirt_maker",
    entityId: input.id,
    leagueId: input.leagueId,
    before: fieldsOf(before),
    after: input.fields,
  });
  return ok(null);
}

/** Takes a maker out of the directory; captains stop seeing it at once. */
export async function removeMaker(
  db: Db,
  input: { leagueId: LeagueId; id: ShirtMakerId; actorId: UserId },
): Promise<Result<null, "not_found">> {
  const before = await makerById(db, input.leagueId, input.id);
  if (!before) return err("not_found");
  await db.delete(shirtMaker).where(eq(shirtMaker.id, input.id));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "shirt_maker.remove",
    entityType: "shirt_maker",
    entityId: input.id,
    leagueId: input.leagueId,
    before: fieldsOf(before),
  });
  return ok(null);
}
