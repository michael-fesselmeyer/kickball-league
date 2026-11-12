import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWebSocket } from "drizzle-orm/neon-serverless";
import { env } from "@/env";
import * as schema from "./schema";

/**
 * HTTP driver: one round trip per query, no pool to warm, the fastest option
 * for single statements on serverless.
 * See docs/architecture.md, section 1 ("Database driver").
 */
export const db = drizzle({
  client: neon(env.DATABASE_URL),
  schema,
  casing: "snake_case",
});

/**
 * WebSocket driver, for the few writes that need an interactive transaction:
 * saving and publishing schedule versions, and payments later.
 */
export const txDb = drizzleWebSocket({
  client: new Pool({ connectionString: env.DATABASE_URL }),
  schema,
  casing: "snake_case",
});
