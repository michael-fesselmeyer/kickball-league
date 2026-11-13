import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { RegistrationId } from "@/domain/ids";
import type { QuizAnswers } from "@/domain/matcher/quiz";
import { registration } from "./team";

/**
 * A free agent's quiz answers (roadmap section 4, milestone 5). The scores
 * are derived from the answers when they are saved, so admins can sort the
 * pool and the matcher can read them without parsing JSON. The row stays
 * after the player is placed, so the matcher can describe a team's vibe.
 */
export const freeAgentProfile = pgTable(
  "free_agent_profile",
  {
    registrationId: uuid()
      .primaryKey()
      .$type<RegistrationId>()
      .references(() => registration.id, { onDelete: "cascade" }),
    answers: jsonb().$type<QuizAnswers>().notNull(),
    skillScore: integer().notNull(),
    vibeScore: integer().notNull(),
    wouldCaptain: boolean().notNull().default(false),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "free_agent_profile_skill_range",
      sql`${t.skillScore} between 1 and 5`,
    ),
    check("free_agent_profile_vibe_range", sql`${t.vibeScore} between 1 and 5`),
    check(
      "free_agent_profile_notes_length",
      sql`${t.notes} is null or char_length(${t.notes}) <= 200`,
    ),
  ],
);

export type FreeAgentProfile = typeof freeAgentProfile.$inferSelect;
