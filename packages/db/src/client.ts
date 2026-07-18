import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadLocalEnv } from "./env";
import * as schema from "./schema";

// IMPORTANT: this uses node-postgres over a pooled connection, NOT a
// serverless HTTP driver.
//
// Applying an event holds an interactive transaction: the learner row is locked
// with SELECT ... FOR UPDATE, then read, then written (see docs/data-model.md).
// HTTP-based drivers (e.g. Neon's @neondatabase/serverless HTTP client) issue
// each statement as a separate request and cannot hold a transaction open — the
// lock would silently do nothing and concurrent events for one learner would
// lose updates. Nothing in the test suite catches that yet: the concurrency test
// arrives with the applier, in the ingest PR. Until then this comment is the
// only guard, so do not swap the driver on the strength of a green CI run.

export type Db = NodePgDatabase<typeof schema>;

export type DbOptions = {
  // Caps how long a single statement may run, so a stuck event transaction
  // cannot hold a learner's row lock indefinitely. Pass 0 to disable — the
  // migrator does, since a long index build is not a stuck transaction.
  statementTimeoutMs?: number;
};

const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;

// Creates an isolated pool + db. Callers that need several live connections at
// once (tests exercising concurrency, the migrator) use this rather than the
// process-wide singleton below.
export function createDb(
  connectionString: string,
  { statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS }: DbOptions = {}
): { pool: Pool; db: Db } {
  const pool = new Pool({
    connectionString,
    // Serverless invocations multiply connections; keep each pool small.
    max: 5,
    ...(statementTimeoutMs > 0 ? { statement_timeout: statementTimeoutMs } : {}),
  });
  return { pool, db: drizzle(pool, { schema }) };
}

let singleton: { pool: Pool; db: Db } | undefined;

// The process-wide connection, built from DATABASE_URL. Takes no arguments on
// purpose: an earlier version accepted a connection string and silently ignored
// it once the singleton existed. Use createDb() for anything else.
export function getDb(): Db {
  return getSingleton().db;
}

export function getPool(): Pool {
  return getSingleton().pool;
}

function getSingleton() {
  if (!singleton) {
    loadLocalEnv();
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to apps/web/.env.local, or export it."
      );
    }
    singleton = createDb(connectionString);
  }
  return singleton;
}
