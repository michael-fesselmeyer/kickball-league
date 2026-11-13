import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EventId,
  LeagueId,
  SocialAccountId,
  SocialImageId,
  SocialPostId,
  TeamId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { event } from "./event";
import { league } from "./league";
import { team } from "./team";

/**
 * Raw bytes, for the stored copy of a synced photo (and the owners' books
 * files, ./books.ts). Sent as Postgres's hex
 * text form, which every driver passes through unchanged; read back as a
 * Buffer (node-postgres) or that same hex text (Neon's HTTP driver).
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer | string }>({
  dataType: () => "bytea",
  toDriver: (value) => `\\x${value.toString("hex")}`,
  fromDriver: (value) =>
    typeof value === "string"
      ? Buffer.from(value.replace(/^\\x/, ""), "hex")
      : Buffer.from(value),
});

export const socialProvider = pgEnum("social_provider", ["instagram"]);

/**
 * active: syncing. needs_reconnect: the token stopped working; synced
 * photos stay up until an admin connects again. disconnected: an admin
 * turned it off and the token is gone.
 */
export const socialAccountStatus = pgEnum("social_account_status", [
  "active",
  "needs_reconnect",
  "disconnected",
]);

/**
 * The league's connected social account (docs/architecture.md, section 17;
 * docs/data-model.md, section 2.8). One per league and provider. The
 * access token is stored encrypted (src/lib/social/token-crypto.ts) and is
 * removed when an admin disconnects.
 */
export const socialAccount = pgTable(
  "social_account",
  {
    id: uuid().primaryKey().defaultRandom().$type<SocialAccountId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    provider: socialProvider().notNull(),
    /** The account's ID at the provider. */
    externalId: text().notNull(),
    username: text().notNull(),
    status: socialAccountStatus().notNull().default("active"),
    /** AES-256-GCM, never logged or shown. Null once disconnected. */
    tokenCiphertext: text(),
    tokenExpiresAt: timestamp({ withTimezone: true }),
    tokenRefreshedAt: timestamp({ withTimezone: true }),
    /** Show the newest posts without an admin featuring each one. */
    showNewest: boolean().notNull().default(false),
    lastSyncedAt: timestamp({ withTimezone: true }),
    /** Why the last sync or refresh failed, in words an admin can act on. */
    lastError: text(),
    connectedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("social_account_league_provider").on(t.leagueId, t.provider),
    check(
      "social_account_token_matches_status",
      sql`(${t.status} = 'disconnected') = (${t.tokenCiphertext} is null)`,
    ),
  ],
);

export const socialMediaType = pgEnum("social_media_type", [
  "image",
  "video",
  "carousel",
]);

/** Where a post is the cover photo: the home page, or its team's page. */
export const socialCover = pgEnum("social_cover", ["home", "team"]);

/**
 * One synced post. Sync updates the caption and link but never the
 * curation (featured, hidden, tags, cover), so an admin's choices survive
 * every later sync. A post deleted at the provider is deleted here at the
 * next sync, with its stored image.
 */
export const socialPost = pgTable(
  "social_post",
  {
    id: uuid().primaryKey().defaultRandom().$type<SocialPostId>(),
    accountId: uuid()
      .notNull()
      .$type<SocialAccountId>()
      .references(() => socialAccount.id, { onDelete: "cascade" }),
    /** The post's ID at the provider. */
    externalId: text().notNull(),
    /** The post on Instagram; every photo shown links back to it. */
    permalink: text().notNull(),
    caption: text(),
    mediaType: socialMediaType().notNull(),
    takenAt: timestamp({ withTimezone: true }).notNull(),
    featured: boolean().notNull().default(false),
    hidden: boolean().notNull().default(false),
    teamId: uuid()
      .$type<TeamId>()
      .references(() => team.id, { onDelete: "set null" }),
    eventId: uuid()
      .$type<EventId>()
      .references(() => event.id, { onDelete: "set null" }),
    cover: socialCover(),
    /** Alt text an admin wrote; the caption stands in until then. */
    altText: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("social_post_once").on(t.accountId, t.externalId),
    index("social_post_account_taken").on(t.accountId, t.takenAt.desc()),
    index("social_post_team").on(t.teamId),
    index("social_post_event").on(t.eventId),
    check(
      "social_post_https_permalink",
      sql`${t.permalink} ~ '^https://www\\.instagram\\.com/'`,
    ),
    check(
      "social_post_hidden_not_shown",
      sql`not (${t.hidden} and (${t.featured} or ${t.cover} is not null))`,
    ),
    check(
      "social_post_team_cover_has_team",
      sql`${t.cover} is distinct from 'team' or ${t.teamId} is not null`,
    ),
    uniqueIndex("social_post_one_home_cover")
      .on(t.accountId)
      .where(sql`${t.cover} = 'home'`),
    uniqueIndex("social_post_one_team_cover")
      .on(t.teamId)
      .where(sql`${t.cover} = 'team'`),
  ],
);

/**
 * Our copy of a post's photo (for a video, its thumbnail). The provider's
 * image addresses expire, so the site never links to them.
 */
export const socialImage = pgTable(
  "social_image",
  {
    id: uuid().primaryKey().defaultRandom().$type<SocialImageId>(),
    postId: uuid()
      .notNull()
      .unique()
      .$type<SocialPostId>()
      .references(() => socialPost.id, { onDelete: "cascade" }),
    contentType: text().notNull(),
    bytes: bytea().notNull(),
    byteSize: integer().notNull(),
    /** Hex SHA-256 of the bytes; the public address's version. */
    sha256: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "social_image_type",
      sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      "social_image_size",
      sql`${t.byteSize} = octet_length(${t.bytes}) and ${t.byteSize} between 1 and 2097152`,
    ),
  ],
);
