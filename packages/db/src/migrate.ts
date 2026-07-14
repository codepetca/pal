import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

// Applies every committed migration in ./drizzle to the database in
// DATABASE_URL. Safe to re-run: already-applied migrations are skipped.
//
//   pnpm --filter @pal/db migrate
//
// Used by developers, by CI's migrate-from-zero check, and by test setup.
export async function runMigrations(connectionString: string): Promise<void> {
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const { pool, db } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
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
