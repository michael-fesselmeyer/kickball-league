import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
  LeagueId,
  LostFoundClaimId,
  LostFoundItemId,
  LostFoundMessageId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { league } from "./league";
import { bytea } from "./social";

export const lostFoundKind = pgEnum("lost_found_kind", ["found", "lost"]);

/**
 * open: on the board. returned: handed back. closed: the poster took it
 * down. expired: closed by the daily job after 30 days. removed: an admin
 * took it down. Anything but open has no photo.
 */
export const lostFoundStatus = pgEnum("lost_found_status", [
  "open",
  "returned",
  "closed",
  "expired",
  "removed",
]);

export const lostFoundClaimStatus = pgEnum("lost_found_claim_status", [
  "open",
  "handed_over",
  "withdrawn",
  "closed",
]);

/**
 * A found item or a lost note on the members-only board (issue #385;
 * docs/data-model.md, section 2.14). The photo is one shrunk JPEG with no
 * metadata plus a small thumbnail, kept in the row like member photos
 * (ADR 0039) and deleted when the post closes, so closed posts cost no
 * storage. An account's deletion deletes its posts.
 */
export const lostFoundItem = pgTable(
  "lost_found_item",
  {
    id: uuid().primaryKey().defaultRandom().$type<LostFoundItemId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    posterId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: lostFoundKind().notNull(),
    description: text().notNull(),
    /** Where it was found or lost: a park, the home bar, or free text. */
    place: text().notNull(),
    /** Where a found item is now. Null for a lost note. */
    whereNow: text(),
    status: lostFoundStatus().notNull().default("open"),
    closedAt: timestamp({ withTimezone: true }),
    /** The admin who removed it. */
    removedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** Whether it was posted with a photo, for the daily photo limit. */
    hadPhoto: boolean().notNull().default(false),
    contentType: text().notNull().default("image/jpeg"),
    /** Null when posted without a photo, and once the post closes. */
    bytes: bytea(),
    byteSize: integer(),
    thumbBytes: bytea(),
    width: integer(),
    height: integer(),
    /** Hex SHA-256 of the stored copy, for its ETag. */
    sha256: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("lost_found_item_board")
      .on(t.leagueId, t.createdAt.desc())
      .where(sql`${t.status} = 'open'`),
    index("lost_found_item_poster").on(t.posterId, t.createdAt.desc()),
    index("lost_found_item_closed")
      .on(t.closedAt)
      .where(sql`${t.status} <> 'open'`),
    check(
      "lost_found_item_closed_when_not_open",
      sql`(${t.status} = 'open') = (${t.closedAt} is null)`,
    ),
    check(
      "lost_found_item_where_now",
      sql`(${t.kind} = 'lost') = (${t.whereNow} is null)`,
    ),
    check(
      "lost_found_item_photo_together",
      sql`(${t.bytes} is null) = (${t.byteSize} is null) and (${t.bytes} is null) = (${t.thumbBytes} is null) and (${t.bytes} is null) = (${t.sha256} is null) and (${t.bytes} is null) = (${t.width} is null) and (${t.bytes} is null) = (${t.height} is null)`,
    ),
    check(
      "lost_found_item_photo_open_only",
      sql`${t.bytes} is null or ${t.status} = 'open'`,
    ),
    check("lost_found_item_type", sql`${t.contentType} = 'image/jpeg'`),
    check(
      "lost_found_item_size",
      sql`${t.bytes} is null or (${t.byteSize} = octet_length(${t.bytes}) and ${t.byteSize} between 1 and 1048576)`,
    ),
    check(
      "lost_found_item_text_length",
      sql`char_length(${t.description}) between 1 and 300 and char_length(${t.place}) between 1 and 80 and (${t.whereNow} is null or char_length(${t.whereNow}) between 1 and 120)`,
    ),
  ],
);

/**
 * "That's mine" on a found item, or "I found it" on a lost note: one
 * answer per person per post, opening a private thread with the poster.
 */
export const lostFoundClaim = pgTable(
  "lost_found_claim",
  {
    id: uuid().primaryKey().defaultRandom().$type<LostFoundClaimId>(),
    itemId: uuid()
      .notNull()
      .$type<LostFoundItemId>()
      .references(() => lostFoundItem.id, { onDelete: "cascade" }),
    responderId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    status: lostFoundClaimStatus().notNull().default("open"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("lost_found_claim_once").on(t.itemId, t.responderId),
    index("lost_found_claim_responder").on(t.responderId, t.createdAt.desc()),
    // At most one hand-over per post.
    uniqueIndex("lost_found_claim_one_handover")
      .on(t.itemId)
      .where(sql`${t.status} = 'handed_over'`),
    check(
      "lost_found_claim_closed_when_not_open",
      sql`(${t.status} = 'open') = (${t.closedAt} is null)`,
    ),
  ],
);

/** One message in a claim's thread, between the poster and the responder. */
export const lostFoundMessage = pgTable(
  "lost_found_message",
  {
    id: uuid().primaryKey().defaultRandom().$type<LostFoundMessageId>(),
    claimId: uuid()
      .notNull()
      .$type<LostFoundClaimId>()
      .references(() => lostFoundClaim.id, { onDelete: "cascade" }),
    authorId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("lost_found_message_claim").on(t.claimId, t.createdAt),
    check(
      "lost_found_message_length",
      sql`char_length(${t.body}) between 1 and 500`,
    ),
  ],
);
