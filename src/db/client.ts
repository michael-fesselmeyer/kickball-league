import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/env";
import * as schema from "./schema";

/**
 * HTTP driver: one round trip per query, no pool to warm, the fastest option
 * for single statements on serverless. Interactive transactions will use the
 * WebSocket driver (drizzle-orm/neon-serverless) where they are needed.
 * See docs/architecture.md, section 1 ("Database driver").
 */
export const db = drizzle({
  client: neon(env.DATABASE_URL),
  schema,
  casing: "snake_case",
});
