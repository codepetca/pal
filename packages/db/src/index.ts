export * as schema from "./schema";
export {
  economy,
  events,
  integrations,
  learners,
  petState,
  worldState,
} from "./schema";
export type {
  Economy,
  Event,
  Integration,
  Learner,
  PetState,
  WorldState,
} from "./schema";
// runMigrations is deliberately not re-exported here. Importing it would pull
// drizzle's migrator into every consumer of this package — including Next.js
// route bundles, which have no business carrying it. Migrations run through the
// CLI entry point instead: pnpm --filter @pal/db migrate.
//
// Exception: integration tests in apps/web need to apply migrations before
// testing. Import runMigrations from @pal/db in test files only — tree-shaking
// keeps it out of route bundles.
export { runMigrations } from "./migrate";
export { createDb, getDb, getPool, type Db } from "./client";
