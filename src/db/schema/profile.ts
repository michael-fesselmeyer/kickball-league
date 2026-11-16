import { sql } from "drizzle-orm";
import {
  check,
  date,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { UserId } from "@/domain/ids";
import { LOCALES } from "@/i18n/locales";
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
  "xxxl",
]);

/**
 * Everything about a person that the league cares about. Better Auth's user
 * row stays auth-only. See docs/data-model.md, section 2.1, and section 4 for
 * who may see which column.
 *
 * Most columns are nullable: a profile is created at first sign-in and filled
 * in at registration. avatar_asset_id arrives with the asset table.
 */
export const profile = pgTable(
  "profile",
  {
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
    /**
     * The language emails, push and (once translated) the app's screens use
     * for this person (ADR 0094). One of LOCALES; English until they pick.
     */
    language: text().notNull().default("en"),
    stripeCustomerId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    // A new language widens this with its catalog (ADR 0094).
    check(
      "profile_language_known",
      sql`${t.language} in (${sql.raw(LOCALES.map((l) => `'${l}'`).join(", "))})`,
    ),
  ],
);

export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
