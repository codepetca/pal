import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// IMPORTANT: this uses node-postgres over a pooled connection, NOT a
// serverless HTTP driver.
//
// Applying an event holds an interactive transaction: the learner row is locked
// with SELECT ... FOR UPDATE, then read, then written (see docs/data-model.md).
// HTTP-based drivers (e.g. Neon's @neondatabase/serverless HTTP client) issue
// each statement as a separate request and cannot hold a transaction open — the
// lock would silently do nothing and concurrent events for one learner would
// lose updates. If you swap this driver, the concurrency test is the only thing
// standing between you and that bug.

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Db | undefined;

export function getPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!pool) {
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({
      connectionString,
      // Serverless invocations multiply connections; keep each pool small.
      max: 5,
      // A stuck transaction must not hold a learner's row lock indefinitely.
      statement_timeout: 10_000,
    });
  }
  return pool;
}

export function getDb(connectionString?: string): Db {
  if (!db) db = drizzle(getPool(connectionString), { schema });
  return db;
}

// Creates an isolated pool + db, bypassing the module-level singletons.
// Tests use this to hold several real connections at once.
export function createDb(connectionString: string): { pool: Pool; db: Db } {
  const p = new Pool({ connectionString, max: 5, statement_timeout: 10_000 });
  return { pool: p, db: drizzle(p, { schema }) };
}
