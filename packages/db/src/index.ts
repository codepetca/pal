export * as schema from "./schema";
export {
  achievementInstances,
  achievementPeriods,
  economy,
  events,
  integrations,
  learnerFacts,
  learners,
  petState,
  rewardNotices,
  storyPlanChapters,
  storyPlans,
  weeklyRhythmConfigs,
  worldState,
} from "./schema";
export type {
  AchievementInstance,
  AchievementPeriod,
  Economy,
  Event,
  Integration,
  LearnerFact,
  Learner,
  PetState,
  RewardNotice,
  StoryPlanChapter,
  StoryPlan,
  WeeklyRhythmConfig,
  WorldState,
} from "./schema";
// runMigrations is deliberately not re-exported here. Importing it would pull
// drizzle's migrator into every consumer of this package — including Next.js
// route bundles, which have no business carrying it. Migrations run through the
// CLI entry point instead: pnpm --filter @pal/db migrate.
export { createDb, getDb, getPool, type Db } from "./client";
