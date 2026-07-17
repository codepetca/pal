import {
  check,
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
    index("events_learner_occurred_idx").on(t.learnerId, t.occurredAt.desc()),
  ]
);

// One economy row per learner — enforced structurally by making learner_id the
// primary key. There is no surrogate key to duplicate.
export const economy = pgTable(
  "economy",
  {
    learnerId: uuid("learner_id")
      .primaryKey()
      .references(() => learners.id, { onDelete: "cascade" }),
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    // Streaks are not computed in the M1 slice; the column exists because the
    // engine's LearnerState type reads it.
    streakCurrent: integer("streak_current").notNull().default(0),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("economy_xp_non_negative", sql`${t.xp} >= 0`),
    check("economy_level_positive", sql`${t.level} >= 1`),
    check("economy_streak_non_negative", sql`${t.streakCurrent} >= 0`),
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
}));

export const learnersRelations = relations(learners, ({ one, many }) => ({
  integration: one(integrations, {
    fields: [learners.integrationId],
    references: [integrations.id],
  }),
  events: many(events),
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
