import { TransactionRollbackError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import type { Db } from "../queries/schedule";
import * as schema from "../schema";

/** Raw SQL with positional parameters, inside the test's transaction. */
export type Sql = (
  text: string,
  values?: unknown[],
) => Promise<Record<string, unknown>[]>;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

/**
 * Runs `body` in a transaction that is always rolled back, so tests leave
 * nothing behind, even on a shared development database.
 */
export async function inRolledBackTransaction(
  body: (sql: Sql) => Promise<void>,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");
    await body(async (text, values) => (await client.query(text, values)).rows);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

/** Expects `statement` to be rejected by the named constraint, then carries on. */
export async function expectViolation(
  sql: Sql,
  constraint: string,
  statement: () => Promise<unknown>,
): Promise<void> {
  await sql("savepoint expect_violation");
  let violated: string | undefined;
  try {
    await statement();
  } catch (error) {
    // pg errors carry the violated constraint's name.
    if (
      error instanceof Error &&
      "constraint" in error &&
      typeof error.constraint === "string"
    )
      violated = error.constraint;
  }
  await sql("rollback to savepoint expect_violation");
  if (violated !== constraint) {
    throw new Error(
      `Expected ${constraint} to reject the row, got ${violated ?? "no error"}`,
    );
  }
}

/** Inserts a row and returns its id. Column names are trusted test input. */
export async function insert(
  sql: Sql,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const columns = Object.keys(row).map((c) => `"${c}"`);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const [created] = await sql(
    `insert into "${table}" (${columns.join(", ")}) values (${placeholders.join(", ")}) returning id`,
    Object.values(row),
  );
  return String(created?.id);
}

/**
 * How many statements the test's connection has sent so far, for tests that
 * hold a screen to a fixed number of queries however many rows it shows.
 */
export type QueriesSent = () => number;

/**
 * Runs `body` with a Drizzle transaction that is always rolled back. Query
 * functions that open their own transaction get a savepoint inside it.
 */
export async function inRolledBackDb(
  body: (db: Db, queriesSent: QueriesSent) => Promise<void>,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  let sent = 0;
  const query = client.query.bind(client);
  // Counts every statement on this connection, then sends it as before.
  const counting = ((...args: Parameters<typeof query>) => {
    sent++;
    return query(...args);
  }) as typeof client.query;
  client.query = counting;
  const db = drizzle({ client, schema, casing: "snake_case" });
  try {
    await db.transaction(async (tx) => {
      await body(tx, () => sent);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  } finally {
    // The pool's connection goes back with its own query method.
    Reflect.deleteProperty(client, "query");
    client.release();
  }
}

export const closePool = () => pool.end();
