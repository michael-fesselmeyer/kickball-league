import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  FriendLeagueId,
  FriendLogoId,
  LeagueId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { bytea } from "./social";

/** The same list, in the same order, as ACTIVITIES in src/domain/friends. */
export const friendActivity = pgEnum("friend_activity", [
  "softball",
  "soccer",
  "volleyball",
  "basketball",
  "dodgeball",
  "flag_football",
  "ultimate",
  "bowling",
  "pool",
  "darts",
  "cornhole",
  "tabletop",
  "trivia",
  "running",
  "other",
]);

/**
 * Another local league in the "friends of the league" directory
 * (docs/data-model.md, section 2.5): softball, soccer, pool, tabletop games
 * and so on. url is the link the public page shows; links_back records that
 * their site links to ours. Removed entries are deleted; the audit log keeps
 * what they said.
 */
export const friendLeague = pgTable(
  "friend_league",
  {
    id: uuid().primaryKey().defaultRandom().$type<FriendLeagueId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    name: text().notNull(),
    activity: friendActivity().notNull(),
    /** A neighborhood or park. */
    area: text(),
    description: text(),
    url: text().notNull(),
    linksBack: boolean().notNull().default(false),
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
    unique("friend_league_name_unique").on(t.leagueId, t.name),
    check(
      "friend_league_name_length",
      sql`char_length(${t.name}) between 1 and 80`,
    ),
    check(
      "friend_league_area_length",
      sql`${t.area} is null or char_length(${t.area}) between 1 and 80`,
    ),
    check(
      "friend_league_description_length",
      sql`${t.description} is null or char_length(${t.description}) between 1 and 280`,
    ),
    // The page links it, so only https, and never a very long address.
    check(
      "friend_league_url_https",
      sql`${t.url} ~ '^https://' and char_length(${t.url}) <= 300`,
    ),
  ],
);

/**
 * A friend league's logo: one small WebP copy made on the server, kept in
 * Postgres like the Instagram photos (ADR 0023). A new upload replaces the
 * row, so the id in its public address changes with the picture.
 */
export const friendLogo = pgTable(
  "friend_logo",
  {
    id: uuid().primaryKey().defaultRandom().$type<FriendLogoId>(),
    friendLeagueId: uuid()
      .notNull()
      .unique()
      .$type<FriendLeagueId>()
      .references(() => friendLeague.id, { onDelete: "cascade" }),
    contentType: text().notNull(),
    bytes: bytea().notNull(),
    byteSize: integer().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    /** Hex SHA-256 of the bytes, for the ETag. */
    sha256: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "friend_logo_type",
      sql`${t.contentType} in ('image/webp', 'image/png')`,
    ),
    check(
      "friend_logo_size",
      sql`${t.byteSize} = octet_length(${t.bytes}) and ${t.byteSize} between 1 and 102400`,
    ),
    check(
      "friend_logo_dimensions",
      sql`${t.width} between 1 and 192 and ${t.height} between 1 and 192`,
    ),
  ],
);
