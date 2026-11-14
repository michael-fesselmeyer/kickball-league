import {
  date,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { UserId } from "@/domain/ids";
import { user } from "./auth";

export const profileGender = pgEnum("profile_gender", [
  "woman",
  "man",
  "nonbinary",
  "self_described",
  "undisclosed",
]);

/** Which side of the fielding rule the player counts toward. The player chooses (open question). */
export const profileLineupGender = pgEnum("profile_lineup_gender", [
  "woman",
  "man",
]);

export const profileShirtSize = pgEnum("profile_shirt_size", [
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "xxl",
]);

export const profileGlobalRole = pgEnum("profile_global_role", [
  "player",
  "admin",
  "owner",
]);

/**
 * Everything about a person that the league cares about. Better Auth's user
 * row stays auth-only. See docs/data-model.md, section 2.1, and section 4 for
 * who may see which column.
 *
 * Most columns are nullable: a profile is created at first sign-in and filled
 * in at registration. avatar_asset_id arrives with the asset table.
 */
export const profile = pgTable("profile", {
  userId: uuid()
    .primaryKey()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "cascade" }),
  firstName: text(),
  lastName: text(),
  phoneE164: text("phone_e164"), // explicit: automatic casing would give phone_e_164
  phoneVerifiedAt: timestamp({ withTimezone: true }),
  gender: profileGender(),
  lineupGender: profileLineupGender(),
  shirtSize: profileShirtSize(),
  birthDate: date({ mode: "string" }),
  globalRole: profileGlobalRole().notNull().default("player"),
  stripeCustomerId: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: uuid()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "set null" }),
});

export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
