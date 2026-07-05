# Rule Engine

> Living document. Update as rule pack schema evolves.
> Last updated: 2026-07-04

---

## Core concept

The rule engine is a **pure function**:

```
(event + current learner state + rule pack) → list of mutations
```

No side effects. No database calls. Fully unit-testable with no infrastructure.
Nothing mutates pet, world, or economy state except the rule engine.

## Rule pack structure

Rules are JSON config — operators can tune gameplay without code changes.

```json
{
  "rules": [
    {
      "id": "assignment-xp",
      "trigger": { "event_type": "assignment.completed" },
      "conditions": [],
      "effects": [
        { "type": "XP_GRANT", "amount": 50 },
        { "type": "PET_MOOD", "mood": "happy", "duration_minutes": 30 }
      ]
    },
    {
      "id": "on-time-bonus",
      "trigger": { "event_type": "assignment.completed" },
      "conditions": [{ "field": "metadata.on_time", "op": "eq", "value": true }],
      "effects": [{ "type": "XP_GRANT", "amount": 25 }]
    },
    {
      "id": "streak-7-world",
      "trigger": { "event_type": "STREAK_MILESTONE" },
      "conditions": [{ "field": "economy.streak_current", "op": "gte", "value": 7 }],
      "effects": [{ "type": "WORLD_UNLOCK", "asset_ref_id": "world-bird-v1" }]
    }
  ]
}
```

## Effect types

| Type | What it does |
|---|---|
| `XP_GRANT` | Add XP to learner economy |
| `PET_MOOD` | Set pet mood for a duration |
| `WORLD_UNLOCK` | Unlock a world object by asset ref |
| `WORLD_STAGE` | Advance world to a specific stage |
| `ACHIEVEMENT` | Award a badge |
| `NUDGE` | Trigger a nudge message referencing a copy pack entry (`copy_id`) |

---

## Derived events

Applying a mutation can create a new fact that rules care about. The canonical example: an `XP_GRANT` updates the streak, the streak crosses 7, and the `streak-7-world` rule should now fire — but that rule triggers on `STREAK_MILESTONE`, an event no integration ever sends.

**How it works:** mutation handlers may return derived events (e.g. the economy handler returns `STREAK_MILESTONE` when a streak crosses a milestone). The applier feeds each derived event back through `evaluate()` and applies the resulting mutations, inside the same transaction as the original event.

Rules of the cascade:

- **The engine stays pure.** It never emits events and never knows about the cascade — only the applier orchestrates re-evaluation.
- **Depth limit: 3.** Original event → derived → derived → stop. A rule pack that cascades deeper is a config bug; the applier logs it to the AuditLog and stops, rather than looping forever.
- **Derived events are synthetic** — they carry `SCREAMING_SNAKE` event types (`STREAK_MILESTONE`, `LEVEL_UP`) to distinguish them from integration events (`assignment.completed`), and they are never accepted on the ingest API.

---

> Rule pack versioning and the operator preview workflow coming in Milestone 2.
