import {
  bigint,
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
  uniqueIndex,
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

// One stable story identity per learner and opaque academic term. The first
// story release pins the authoritative term start, catalog version, and one
// supported term length. Migration triggers make that identity immutable; the
// normalized rows and deferred checks require a complete plan at commit.
// No student work or PII is stored.
export const storyPlans = pgTable(
  "story_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    termKey: text("term_key").notNull(),
    termStartDay: date("term_start_day").notNull(),
    storyId: text("story_id").notNull(),
    storyVersion: integer("story_version").notNull(),
    totalPeriods: integer("total_periods").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("story_plans_learner_term_uq").on(t.learnerId, t.termKey),
    unique("story_plans_id_learner_uq").on(t.id, t.learnerId),
    check("story_plans_version_positive", sql`${t.storyVersion} >= 1`),
    check(
      "story_plans_period_count_range",
      sql`${t.totalPeriods} >= 6 AND ${t.totalPeriods} <= 24`,
    ),
  ],
);

// A normalized chapter assignment avoids nullable/multidimensional array
// states and gives each stable ordinal at most one opaque period binding.
// Migration triggers make the assignment immutable and permit period_key to
// move only once from null to its learner-owned opaque week.
export const storyPlanChapters = pgTable(
  "story_plan_chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyPlanId: uuid("story_plan_id").notNull(),
    learnerId: uuid("learner_id").notNull(),
    periodNumber: integer("period_number").notNull(),
    periodKey: text("period_key"),
    chapterId: text("chapter_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("story_plan_chapters_plan_period_number_uq").on(
      t.storyPlanId,
      t.periodNumber,
    ),
    unique("story_plan_chapters_plan_period_key_uq").on(
      t.storyPlanId,
      t.periodKey,
    ),
    unique("story_plan_chapters_plan_chapter_uq").on(
      t.storyPlanId,
      t.chapterId,
    ),
    unique("story_plan_chapters_learner_period_uq").on(
      t.learnerId,
      t.periodKey,
    ),
    unique("story_plan_chapters_id_plan_learner_uq").on(
      t.id,
      t.storyPlanId,
      t.learnerId,
    ),
    foreignKey({
      columns: [t.storyPlanId, t.learnerId],
      foreignColumns: [storyPlans.id, storyPlans.learnerId],
      name: "story_plan_chapters_plan_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.learnerId, t.periodKey],
      foreignColumns: [achievementPeriods.learnerId, achievementPeriods.periodKey],
      name: "story_plan_chapters_period_owner_fk",
    }).onDelete("cascade"),
    check(
      "story_plan_chapters_period_number_range",
      sql`${t.periodNumber} >= 1 AND ${t.periodNumber} <= 24`,
    ),
    check(
      "story_plan_chapters_chapter_id_nonempty",
      sql`length(${t.chapterId}) > 0`,
    ),
  ],
);

// Append-only durable ownership ledger. Source facts group grants from one
// accepted action; grant_order gives those action groups stable database order
// even when timestamps collide. Story content is resolved from the exact
// pinned plan assignment at read time and is never copied into this table.
export const learnerRewardGrants = pgTable(
  "learner_reward_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grantOrder: bigint("grant_order", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
    learnerId: uuid("learner_id").notNull(),
    kind: text("kind").notNull(),
    sourceFactId: uuid("source_fact_id").notNull(),
    storyPlanId: uuid("story_plan_id"),
    storyPlanChapterId: uuid("story_plan_chapter_id"),
    behaviorTitleId: text("behavior_title_id"),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("learner_reward_grants_order_uq").on(t.grantOrder),
    foreignKey({
      columns: [t.sourceFactId, t.learnerId],
      foreignColumns: [learnerFacts.id, learnerFacts.learnerId],
      name: "learner_reward_grants_source_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.storyPlanId, t.learnerId],
      foreignColumns: [storyPlans.id, storyPlans.learnerId],
      name: "learner_reward_grants_plan_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.storyPlanChapterId, t.storyPlanId, t.learnerId],
      foreignColumns: [
        storyPlanChapters.id,
        storyPlanChapters.storyPlanId,
        storyPlanChapters.learnerId,
      ],
      name: "learner_reward_grants_chapter_owner_fk",
    }).onDelete("cascade"),
    check(
      "learner_reward_grants_kind_payload",
      sql`(
        ${t.kind} = 'story_chapter'
        AND ${t.storyPlanId} IS NOT NULL
        AND ${t.storyPlanChapterId} IS NOT NULL
        AND ${t.behaviorTitleId} IS NULL
      ) OR (
        ${t.kind} = 'behavior_title'
        AND ${t.storyPlanId} IS NULL
        AND ${t.storyPlanChapterId} IS NULL
        AND length(btrim(${t.behaviorTitleId})) > 0
      )`,
    ),
    uniqueIndex("learner_reward_grants_story_slot_uq")
      .on(t.storyPlanChapterId)
      .where(sql`${t.kind} = 'story_chapter'`),
    uniqueIndex("learner_reward_grants_story_source_uq")
      .on(t.learnerId, t.sourceFactId)
      .where(sql`${t.kind} = 'story_chapter'`),
    uniqueIndex("learner_reward_grants_behavior_title_uq")
      .on(t.learnerId, t.behaviorTitleId)
      .where(sql`${t.kind} = 'behavior_title'`),
    index("learner_reward_grants_projection_idx").on(
      t.learnerId,
      t.grantOrder.desc(),
    ),
    index("learner_reward_grants_unseen_idx").on(t.learnerId, t.seenAt),
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

// Durable learner title awards. Runtime awards preserve source-event history;
// nullable provenance explicitly marks a pre-ledger migration whose original
// earning fact cannot be reconstructed. created_at records when PAL recorded
// the grant. Snapshot reads use grant order, with story titles winning
// same-action ties.
export const titleAwards = pgTable(
  "title_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => learners.id, { onDelete: "cascade" }),
    titleId: text("title_id").notNull(),
    kind: text("kind").notNull(),
    sourceFactId: uuid("source_fact_id"),
    earnedAt: timestamp("earned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("title_awards_learner_title_uq").on(t.learnerId, t.titleId),
    check("title_awards_title_nonempty", sql`length(btrim(${t.titleId})) > 0`),
    check("title_awards_kind_valid", sql`${t.kind} IN ('behavior', 'story')`),
    foreignKey({
      columns: [t.sourceFactId, t.learnerId],
      foreignColumns: [learnerFacts.id, learnerFacts.learnerId],
      name: "title_awards_source_owner_fk",
    }).onDelete("cascade"),
    index("title_awards_current_idx").on(t.learnerId, t.createdAt.desc()),
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
  storyPlans: many(storyPlans),
  rewardGrants: many(learnerRewardGrants),
  weeklyRhythmConfigs: many(weeklyRhythmConfigs),
  achievementInstances: many(achievementInstances),
  titleAwards: many(titleAwards),
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

export const titleAwardsRelations = relations(titleAwards, ({ one }) => ({
  learner: one(learners, {
    fields: [titleAwards.learnerId],
    references: [learners.id],
  }),
  sourceFact: one(learnerFacts, {
    fields: [titleAwards.sourceFactId, titleAwards.learnerId],
    references: [learnerFacts.id, learnerFacts.learnerId],
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

export const storyPlansRelations = relations(storyPlans, ({ one, many }) => ({
  learner: one(learners, {
    fields: [storyPlans.learnerId],
    references: [learners.id],
  }),
  chapters: many(storyPlanChapters),
  rewardGrants: many(learnerRewardGrants),
}));

export const storyPlanChaptersRelations = relations(
  storyPlanChapters,
  ({ one, many }) => ({
    storyPlan: one(storyPlans, {
      fields: [storyPlanChapters.storyPlanId, storyPlanChapters.learnerId],
      references: [storyPlans.id, storyPlans.learnerId],
    }),
    period: one(achievementPeriods, {
      fields: [storyPlanChapters.learnerId, storyPlanChapters.periodKey],
      references: [achievementPeriods.learnerId, achievementPeriods.periodKey],
    }),
    rewardGrants: many(learnerRewardGrants),
  }),
);

export const learnerRewardGrantsRelations = relations(
  learnerRewardGrants,
  ({ one }) => ({
    learner: one(learners, {
      fields: [learnerRewardGrants.learnerId],
      references: [learners.id],
    }),
    sourceFact: one(learnerFacts, {
      fields: [learnerRewardGrants.sourceFactId, learnerRewardGrants.learnerId],
      references: [learnerFacts.id, learnerFacts.learnerId],
    }),
    storyPlan: one(storyPlans, {
      fields: [learnerRewardGrants.storyPlanId, learnerRewardGrants.learnerId],
      references: [storyPlans.id, storyPlans.learnerId],
    }),
    storyPlanChapter: one(storyPlanChapters, {
      fields: [
        learnerRewardGrants.storyPlanChapterId,
        learnerRewardGrants.storyPlanId,
        learnerRewardGrants.learnerId,
      ],
      references: [
        storyPlanChapters.id,
        storyPlanChapters.storyPlanId,
        storyPlanChapters.learnerId,
      ],
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
export type StoryPlan = typeof storyPlans.$inferSelect;
export type StoryPlanChapter = typeof storyPlanChapters.$inferSelect;
export type LearnerRewardGrant = typeof learnerRewardGrants.$inferSelect;
export type WeeklyRhythmConfig = typeof weeklyRhythmConfigs.$inferSelect;
export type AchievementInstance = typeof achievementInstances.$inferSelect;
export type RewardNotice = typeof rewardNotices.$inferSelect;
export type TitleAward = typeof titleAwards.$inferSelect;
