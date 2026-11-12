import { neon, Pool } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWebSocket } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool as NodePostgresPool } from "pg";
import { env } from "@/env";
import { isLocalDatabase } from "./local";
import * as schema from "./schema";

/** What every query needs: Drizzle's query builder over any Postgres driver. */
type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

const config = { schema, casing: "snake_case" } as const;

function neonClients(url: string): { db: Database; txDb: Database } {
  return {
    /**
     * HTTP driver: one round trip per query, no pool to warm, the fastest
     * option for single statements on serverless.
     * See docs/architecture.md, section 1 ("Database driver").
     */
    db: drizzle({ client: neon(url), ...config }),
    /**
     * WebSocket driver, for the few writes that need an interactive
     * transaction: saving and publishing schedule versions, and payments.
     */
    txDb: drizzleWebSocket({
      client: new Pool({ connectionString: url }),
      ...config,
    }),
  };
}

/**
 * A plain Postgres on this machine (local development, and the end-to-end
 * tests in CI) has no Neon proxy, so both clients share one node-postgres
 * pool (docs/adr/0007-end-to-end-tests-on-local-services.md).
 */
function localClients(url: string): { db: Database; txDb: Database } {
  const local = drizzleNodePostgres({
    client: new NodePostgresPool({ connectionString: url, max: 5 }),
    ...config,
  });
  return { db: local, txDb: local };
}

export const { db, txDb } = isLocalDatabase(env.DATABASE_URL)
  ? localClients(env.DATABASE_URL)
  : neonClients(env.DATABASE_URL);
