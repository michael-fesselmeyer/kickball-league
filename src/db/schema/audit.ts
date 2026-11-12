import { sql } from "drizzle-orm";
import {
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AuditLogId, UserId } from "@/domain/ids";
import { user } from "./auth";

/**
 * Who changed what, with before and after, for every admin and captain
 * change. Rows are only ever added. See docs/data-model.md, section 2.7.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom().$type<AuditLogId>(),
    /** Null for changes the system makes on its own. */
    actorId: uuid()
      .$type<UserId>()
      .references(() => user.id, { onDelete: "set null" }),
    /** For example schedule.publish or payment.refund. */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    before: jsonb(),
    after: jsonb(),
    ip: inet(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(
      t.entityType,
      t.entityId,
      t.occurredAt.desc(),
    ),
    index("audit_log_actor_idx").on(t.actorId, t.occurredAt.desc()),
    check("audit_log_action_format", sql`${t.action} ~ '^[a-z_]+\\.[a-z_]+$'`),
  ],
);
