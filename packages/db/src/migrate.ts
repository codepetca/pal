import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDb } from "./client";
import { loadLocalEnv } from "./env";

// Applies every committed migration in ./drizzle to the database in
// DATABASE_URL. Safe to re-run: already-applied migrations are skipped.
//
//   pnpm --filter @pal/db migrate
//
// Used by developers, by CI's migrate-from-zero check, and by test setup.
export async function runMigrations(connectionString: string): Promise<void> {
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  // No statement timeout: a migration that builds an index over a populated
  // table can legitimately run for minutes, and aborting one halfway is far
  // worse than letting it finish.
  const { pool, db } = createDb(connectionString, { statementTimeoutMs: 0 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Copy .env.example to apps/web/.env.local, or export it."
    );
    process.exit(1);
  }
  runMigrations(url).then(
    () => console.log("migrations applied"),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
