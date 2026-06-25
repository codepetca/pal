# @pal/db

Database schema and migrations.

This package owns all table definitions and migration files. No business logic lives here — just schema.

## Coming in Milestone 1 (M1)

- ORM setup (Drizzle)
- Initial migration: `integrations`, `learners`, `events`, `economy`, `pet_state`, `world_state`

## Convention

- One migration file per PR
- Migrations are append-only — never edit an existing migration
- Migration filenames: `0001_initial_schema.sql`, `0002_add_unlock_ledger.sql`
