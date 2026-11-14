import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { UserId } from "@/domain/ids";
import { user } from "./auth";

/**
 * A player's emergency contact and first-aid note (docs/data-model.md,
 * section 2.1), sealed: `sealed` holds the card encrypted with a key derived
 * from the server's auth secret and bound to the player's id
 * (src/lib/crypto/sealed.ts, docs/adr/0043-emergency-contacts-sealed-and-shown-on-game-day.md).
 * A database copy alone reads nothing. Deleting the account deletes it.
 */
export const emergencyContact = pgTable("emergency_contact", {
  userId: uuid()
    .primaryKey()
    .$type<UserId>()
    .references(() => user.id, { onDelete: "cascade" }),
  sealed: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type EmergencyContact = typeof emergencyContact.$inferSelect;
