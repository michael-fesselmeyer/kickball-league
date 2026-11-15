import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  LeagueId,
  RegistrationId,
  ShirtMakerId,
  ShirtSpareId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { profileShirtSize } from "./profile";
import { registration } from "./team";

/**
 * Shirts for players who join after an order (docs/data-model.md, section
 * 2.1): the league's spare stock, kept as a ledger, and the directory of
 * local shirt makers shown to captains whose team wears its own.
 */

/**
 * One change to the league's spare shirts: a positive delta logs spares
 * left from an earlier order, a negative one hands a spare to a player (its
 * registration is set). A size's stock is the sum of its deltas, never
 * below zero. Rows are never edited or deleted.
 */
export const shirtSpare = pgTable(
  "shirt_spare",
  {
    id: uuid().primaryKey().defaultRandom().$type<ShirtSpareId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    size: profileShirtSize().notNull(),
    delta: integer().notNull(),
    /** The player a spare was handed to; null for stock logged. */
    registrationId: uuid()
      .$type<RegistrationId>()
      .references(() => registration.id, { onDelete: "set null" }),
    note: text(),
    actorId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shirt_spare_league_size_idx").on(t.leagueId, t.size),
    check(
      "shirt_spare_delta",
      sql`${t.delta} between -1 and 500 and ${t.delta} <> 0`,
    ),
    check(
      "shirt_spare_handout",
      sql`${t.delta} < 0 or ${t.registrationId} is null`,
    ),
    check(
      "shirt_spare_note",
      sql`${t.note} is null or char_length(${t.note}) between 1 and 200`,
    ),
  ],
);

/**
 * A local custom jersey or t-shirt maker in the directory captains see when
 * their team wears its own shirts. url is the https link the page shows,
 * checked on the server like the friends directory's. Removed makers are
 * deleted; the audit log keeps what they said.
 */
export const shirtMaker = pgTable(
  "shirt_maker",
  {
    id: uuid().primaryKey().defaultRandom().$type<ShirtMakerId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    name: text().notNull(),
    url: text().notNull(),
    /** What they make: "Custom jerseys and team t-shirts". */
    makes: text().notNull(),
    /** The fewest pieces they will print; null when they have no minimum. */
    minimumOrder: integer(),
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
    unique("shirt_maker_name_unique").on(t.leagueId, t.name),
    check(
      "shirt_maker_name_length",
      sql`char_length(${t.name}) between 1 and 80`,
    ),
    check(
      "shirt_maker_makes_length",
      sql`char_length(${t.makes}) between 1 and 200`,
    ),
    check(
      "shirt_maker_minimum",
      sql`${t.minimumOrder} is null or ${t.minimumOrder} between 1 and 1000`,
    ),
    check(
      "shirt_maker_url_https",
      sql`${t.url} ~ '^https://' and char_length(${t.url}) <= 300`,
    ),
  ],
);

export type ShirtMaker = typeof shirtMaker.$inferSelect;
