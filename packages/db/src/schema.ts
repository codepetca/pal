import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Schema only. No business logic lives in this package — see packages/db/README.md.
//
// Privacy: no column here holds a name, email, raw student ID, grade, score,
// ranking, or student writing. The only free-form field is events.metadata,
// which the API boundary gates with a per-event-type allow-list.

// A registered external system (e.g. Pika). Owns its secret, its allowed event
// types, and the rule pack its events are evaluated against.
export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stable handle used by seeds and config, e.g. "sandbox".
  slug: text("slug").notNull().unique(),
  // The organisation's name — never a student's.
  name: text("name").notNull(),
  // SHA-256 hex of the bearer secret. The plaintext secret is never stored:
  // ingest hashes the presented bearer and looks it up here.
  secretHash: text("secret_hash").notNull().unique(),
  allowedEventTypes: text("allowed_event_types")
    .array()
    .notNull()
    .default(sql`'{}'`),
  rulePackId: text("rule_pack_id").notNull().default("default-v1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A pseudonymous learner. `id` is ours; `external_learner_id` is the
// integration's pre-hashed token. Keeping them separate means nothing else in
// the schema ever references the value an integration sent us.
export const learners = pgTable(
  "learners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    externalLearnerId: text("external_learner_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Also the lookup index for ingest and the world route.
    unique("learners_integration_external_uq").on(t.integrationId, t.externalLearnerId),
    unique("learners_id_integration_uq").on(t.id, t.integrationId),
  ]
);

// A learning signal received from an integration. Immutable once written.
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    // This constraint IS the idempotency mechanism: ingest inserts with
    // ON CONFLICT DO NOTHING and treats "no row returned" as a duplicate,
    // rather than doing a read-then-write check that could race.
    unique("events_integration_idempotency_uq").on(t.integrationId, t.idempotencyKey),
    unique("events_id_learner_integration_uq").on(
      t.id,
      t.learnerId,
      t.integrationId,
    ),
    foreignKey({
      columns: [t.learnerId, t.integrationId],
      foreignColumns: [learners.id, learners.integrationId],
      name: "events_learner_integration_owner_fk",
    }).onDelete("cascade"),
    index("events_learner_occurred_idx").on(t.learnerId, t.occurredAt.desc()),
  ]
);

// A semantically unique, privacy-safe fact derived from an accepted event. An
// integration retry is deduplicated by events.idempotency_key; this second
// ledger independently prevents a producer from changing the idempotency key
// and counting the same learner behavior twice.
export const learnerFacts = pgTable(
  "learner_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id").notNull(),
    learnerId: uuid("learner_id").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    eventType: text("event_type").notNull(),
    semanticKey: text("semantic_key").notNull(),
    periodKey: text("period_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("learner_facts_semantic_uq").on(
      t.learnerId,
      t.eventType,
      t.semanticKey,
    ),
    unique("learner_facts_id_learner_uq").on(t.id, t.learnerId),
    foreignKey({
      columns: [t.sourceEventId, t.learnerId, t.integrationId],
      foreignColumns: [events.id, events.learnerId, events.integrationId],
      name: "learner_facts_source_owner_fk",
    }).onDelete("cascade"),
    index("learner_facts_period_idx").on(t.learnerId, t.periodKey),
    // Settlement and achievement reads filter one learner, event type, and
    // academic period before applying small limits. Keeping all three columns
    // in the access path prevents unrelated period facts from being scanned.
    index("learner_facts_event_period_idx").on(
      t.learnerId,
      t.eventType,
      t.periodKey,
    ),
  ],
);

// Stable roadmap placement for opaque academic periods. Period keys remain
// integration-owned and are never exposed in learner snapshots.
export const achievementPeriods = pgTable(
  "achievement_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    // Earliest authoritative behavior/configuration time seen for this opaque
    // period. Snapshot ordering uses this, never delivery or row creation order.
    anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("achievement_periods_learner_period_uq").on(
      t.learnerId,
      t.periodKey,
    ),
  ],
);

export const weeklyRhythmConfigs = pgTable(
  "weekly_rhythm_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    configVersion: integer("config_version").notNull(),
    periodStatus: text("period_status").notNull(),
    eligibleDays: integer("eligible_days").notNull(),
    reconciliationRequired: boolean("reconciliation_required")
      .notNull()
      .default(false),
    configuredAt: timestamp("configured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("weekly_rhythm_configs_learner_period_uq").on(
      t.learnerId,
      t.periodKey,
    ),
    check("weekly_rhythm_configs_version_positive", sql`${t.configVersion} >= 1`),
    check(
      "weekly_rhythm_configs_eligible_days_range",
      sql`${t.eligibleDays} >= 0 AND ${t.eligibleDays} <= 5`,
    ),
    check(
      "weekly_rhythm_configs_status_valid",
      sql`${t.periodStatus} IN ('open', 'closed')`,
    ),
    foreignKey({
      columns: [t.learnerId, t.periodKey],
      foreignColumns: [
        achievementPeriods.learnerId,
        achievementPeriods.periodKey,
      ],
      name: "weekly_rhythm_configs_period_owner_fk",
    }).onDelete("cascade"),
  ],
);

// One row per achievement definition and semantic scope. Lifetime, classroom,
// item, and weekly recurrence all use the same structural uniqueness rule.
export const achievementInstances = pgTable(
  "achievement_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    achievementKey: text("achievement_key").notNull(),
    scopeKey: text("scope_key").notNull(),
    periodKey: text("period_key"),
    status: text("status").notNull(),
    progressCurrent: integer("progress_current"),
    progressTarget: integer("progress_target"),
    earnedAt: timestamp("earned_at", { withTimezone: true }),
    sourceFactId: uuid("source_fact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("achievement_instances_scope_uq").on(
      t.learnerId,
      t.achievementKey,
      t.scopeKey,
    ),
    unique("achievement_instances_id_learner_uq").on(t.id, t.learnerId),
    index("achievement_instances_period_idx").on(t.learnerId, t.periodKey),
    check(
      "achievement_instances_status_valid",
      sql`${t.status} IN ('earned', 'in-progress', 'incomplete')`,
    ),
    check(
      "achievement_instances_progress_non_negative",
      sql`${t.progressCurrent} IS NULL OR ${t.progressCurrent} >= 0`,
    ),
    check(
      "achievement_instances_target_positive",
      sql`${t.progressTarget} IS NULL OR ${t.progressTarget} >= 1`,
    ),
    foreignKey({
      columns: [t.sourceFactId, t.learnerId],
      foreignColumns: [learnerFacts.id, learnerFacts.learnerId],
      name: "achievement_instances_source_owner_fk",
    }),
    foreignKey({
      columns: [t.learnerId, t.periodKey],
      foreignColumns: [
        achievementPeriods.learnerId,
        achievementPeriods.periodKey,
      ],
      name: "achievement_instances_period_owner_fk",
    }),
  ],
);

export const rewardNotices = pgTable(
  "reward_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id").notNull(),
    achievementInstanceId: uuid("achievement_instance_id").notNull(),
    rewardKey: text("reward_key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    icon: text("icon"),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("reward_notices_achievement_uq").on(t.achievementInstanceId),
    foreignKey({
      columns: [t.achievementInstanceId, t.learnerId],
      foreignColumns: [achievementInstances.id, achievementInstances.learnerId],
      name: "reward_notices_achievement_owner_fk",
    }).onDelete("cascade"),
    index("reward_notices_unseen_idx").on(t.learnerId, t.seenAt),
  ],
);

// One economy row per learner — enforced structurally by making learner_id the
// primary key. There is no surrogate key to duplicate.
export const economy = pgTable(
  "economy",
  {
    learnerId: uuid("learner_id")
      .primaryKey()
      .references(() => learners.id, { onDelete: "cascade" }),
    // xp is the balance toward the next level — a level-up spends it. xp_lifetime
    // is every point ever earned, never spent; lifetime achievements key on it.
    // See the Economy entity in docs/data-model.md.
    xp: integer("xp").notNull().default(0),
    xpLifetime: integer("xp_lifetime").notNull().default(0),
    level: integer("level").notNull().default(1),
    // Streaks are not computed in the M1 slice; the column exists because the
    // engine's LearnerState type reads it.
    streakCurrent: integer("streak_current").notNull().default(0),
    // UTC calendar day (YYYY-MM-DD) the streak last advanced. Anchors day-over-day
    // continuity and the engine's forward-only streak guard; null until the first
    // check-in or after a rule breaks the streak.
    streakLastDay: date("streak_last_day"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("economy_xp_non_negative", sql`${t.xp} >= 0`),
    check("economy_level_positive", sql`${t.level} >= 1`),
    check("economy_streak_non_negative", sql`${t.streakCurrent} >= 0`),
    // Spending never touches lifetime and earning raises both, so the balance can
    // never exceed lifetime. A write that violates this is a persistence bug.
    check("economy_xp_lifetime_gte_xp", sql`${t.xpLifetime} >= ${t.xp}`),
  ]
);

// One pet-state row per learner.
export const petState = pgTable("pet_state", {
  learnerId: uuid("learner_id")
    .primaryKey()
    .references(() => learners.id, { onDelete: "cascade" }),
  // Free text, not an enum: rule packs are meant to be tunable config, and a
  // new mood should not require a migration.
  mood: text("mood").notNull().default("neutral"),
  moodExpiresAt: timestamp("mood_expires_at", { withTimezone: true }),
  animationState: text("animation_state").notNull().default("idle"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One world-state row per learner.
export const worldState = pgTable(
  "world_state",
  {
    learnerId: uuid("learner_id")
      .primaryKey()
      .references(() => learners.id, { onDelete: "cascade" }),
    stage: integer("stage").notNull().default(0),
    unlockedObjectIds: text("unlocked_object_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("world_state_stage_non_negative", sql`${t.stage} >= 0`)]
);

export const integrationsRelations = relations(integrations, ({ many }) => ({
  learners: many(learners),
  events: many(events),
  learnerFacts: many(learnerFacts),
}));

export const learnersRelations = relations(learners, ({ one, many }) => ({
  integration: one(integrations, {
    fields: [learners.integrationId],
    references: [integrations.id],
  }),
  events: many(events),
  facts: many(learnerFacts),
  periods: many(achievementPeriods),
  weeklyRhythmConfigs: many(weeklyRhythmConfigs),
  achievementInstances: many(achievementInstances),
  rewardNotices: many(rewardNotices),
  economy: one(economy),
  petState: one(petState),
  worldState: one(worldState),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  integration: one(integrations, {
    fields: [events.integrationId],
    references: [integrations.id],
  }),
  learner: one(learners, { fields: [events.learnerId], references: [learners.id] }),
}));

export const learnerFactsRelations = relations(learnerFacts, ({ one }) => ({
  integration: one(integrations, {
    fields: [learnerFacts.integrationId],
    references: [integrations.id],
  }),
  learner: one(learners, {
    fields: [learnerFacts.learnerId],
    references: [learners.id],
  }),
  sourceEvent: one(events, {
    fields: [learnerFacts.sourceEventId],
    references: [events.id],
  }),
}));

export const achievementPeriodsRelations = relations(
  achievementPeriods,
  ({ one }) => ({
    learner: one(learners, {
      fields: [achievementPeriods.learnerId],
      references: [learners.id],
    }),
  }),
);

export const weeklyRhythmConfigsRelations = relations(
  weeklyRhythmConfigs,
  ({ one }) => ({
    learner: one(learners, {
      fields: [weeklyRhythmConfigs.learnerId],
      references: [learners.id],
    }),
  }),
);

export const achievementInstancesRelations = relations(
  achievementInstances,
  ({ one, many }) => ({
    learner: one(learners, {
      fields: [achievementInstances.learnerId],
      references: [learners.id],
    }),
    sourceFact: one(learnerFacts, {
      fields: [achievementInstances.sourceFactId],
      references: [learnerFacts.id],
    }),
    rewardNotices: many(rewardNotices),
  }),
);

export const rewardNoticesRelations = relations(rewardNotices, ({ one }) => ({
  learner: one(learners, {
    fields: [rewardNotices.learnerId],
    references: [learners.id],
  }),
  achievementInstance: one(achievementInstances, {
    fields: [rewardNotices.achievementInstanceId],
    references: [achievementInstances.id],
  }),
}));

export const economyRelations = relations(economy, ({ one }) => ({
  learner: one(learners, { fields: [economy.learnerId], references: [learners.id] }),
}));

export const petStateRelations = relations(petState, ({ one }) => ({
  learner: one(learners, { fields: [petState.learnerId], references: [learners.id] }),
}));

export const worldStateRelations = relations(worldState, ({ one }) => ({
  learner: one(learners, { fields: [worldState.learnerId], references: [learners.id] }),
}));

export type Integration = typeof integrations.$inferSelect;
export type Learner = typeof learners.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Economy = typeof economy.$inferSelect;
export type PetState = typeof petState.$inferSelect;
export type WorldState = typeof worldState.$inferSelect;
export type LearnerFact = typeof learnerFacts.$inferSelect;
export type AchievementPeriod = typeof achievementPeriods.$inferSelect;
export type WeeklyRhythmConfig = typeof weeklyRhythmConfigs.$inferSelect;
export type AchievementInstance = typeof achievementInstances.$inferSelect;
export type RewardNotice = typeof rewardNotices.$inferSelect;
