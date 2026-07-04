# Rule Engine

> Living document. Update as rule pack schema evolves.
> Last updated: 2026-06-25

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

> Rule pack versioning and the operator preview workflow coming in Milestone 2.
