import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  EventId,
  GameId,
  LeagueId,
  MemberPhotoId,
  TeamId,
  UserId,
} from "@/domain/ids";
import { user } from "./auth";
import { event } from "./event";
import { game } from "./game";
import { league } from "./league";
import { bytea } from "./social";
import { team } from "./team";

/**
 * pending: waiting in the admins' review queue. approved: shown on the
 * public pages it is tagged to, and free for the league to repost.
 * rejected: not used; its bytes are deleted at once to free storage.
 */
export const memberPhotoStatus = pgEnum("member_photo_status", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * A photo a member uploaded for the league's socials (ADR 0039;
 * docs/data-model.md, section 2.8). One resized JPEG copy with no metadata,
 * stored here because the photos are few and small and the project has no
 * file store. Tagged to a game day, an event or a team (at least one when
 * uploaded; a tag goes away with what it names). Deleted with its uploader's
 * account.
 */
export const memberPhoto = pgTable(
  "member_photo",
  {
    id: uuid().primaryKey().defaultRandom().$type<MemberPhotoId>(),
    leagueId: uuid()
      .notNull()
      .$type<LeagueId>()
      .references(() => league.id, { onDelete: "cascade" }),
    uploaderId: uuid()
      .notNull()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "cascade" }),
    status: memberPhotoStatus().notNull().default("pending"),
    gameId: uuid()
      .$type<GameId>()
      .references(() => game.id, { onDelete: "set null" }),
    eventId: uuid()
      .$type<EventId>()
      .references(() => event.id, { onDelete: "set null" }),
    teamId: uuid()
      .$type<TeamId>()
      .references(() => team.id, { onDelete: "set null" }),
    caption: text(),
    /** When the uploader ticked "The league may repost this on its socials". */
    repostConsentAt: timestamp({ withTimezone: true }).notNull(),
    contentType: text().notNull().default("image/jpeg"),
    /** Null once rejected: a photo the league won't use isn't kept. */
    bytes: bytea(),
    byteSize: integer(),
    width: integer().notNull(),
    height: integer().notNull(),
    /** Hex SHA-256 of the stored copy, for its ETag. */
    sha256: text().notNull(),
    reviewedBy: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp({ withTimezone: true }),
    /** Why it was rejected, for admins only; the uploader never sees it. */
    reviewNote: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("member_photo_league_status").on(
      t.leagueId,
      t.status,
      t.createdAt.desc(),
    ),
    index("member_photo_uploader").on(t.uploaderId, t.createdAt.desc()),
    index("member_photo_team")
      .on(t.teamId, t.createdAt.desc())
      .where(sql`${t.status} = 'approved'`),
    index("member_photo_event")
      .on(t.eventId, t.createdAt.desc())
      .where(sql`${t.status} = 'approved'`),
    index("member_photo_game")
      .on(t.gameId, t.createdAt.desc())
      .where(sql`${t.status} = 'approved'`),
    check("member_photo_type", sql`${t.contentType} = 'image/jpeg'`),
    check(
      "member_photo_bytes_unless_rejected",
      sql`(${t.status} = 'rejected') = (${t.bytes} is null) and (${t.bytes} is null) = (${t.byteSize} is null)`,
    ),
    check(
      "member_photo_size",
      sql`${t.bytes} is null or (${t.byteSize} = octet_length(${t.bytes}) and ${t.byteSize} between 1 and 1048576)`,
    ),
    check(
      "member_photo_dimensions",
      sql`${t.width} between 1 and 1440 and ${t.height} between 1 and 1440`,
    ),
    check("member_photo_caption_length", sql`char_length(${t.caption}) <= 200`),
    check("member_photo_note_length", sql`char_length(${t.reviewNote}) <= 500`),
    check(
      "member_photo_reviewed",
      sql`(${t.status} = 'pending') = (${t.reviewedAt} is null)`,
    ),
  ],
);
