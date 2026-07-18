# API Contracts

> Living document. Update as endpoints are finalized.
> Last updated: 2026-06-25

---

## Endpoints (planned)

| Method | Path | Who calls it | Purpose |
|---|---|---|---|
| POST | `/api/v1/events` | Integration backend | Ingest a learning signal |
| GET | `/api/v1/world/:learner_id` | Widget (via read token) | Fetch pet + world state |
| POST | `/api/v1/integration/read-token` | Integration backend | Mint a short-lived read token for a learner |
| POST | `/api/v1/admin/rule-preview` | Operator | Simulate an event against a rule pack |
| POST | `/api/v1/learner/delete` | Integration backend | Purge a learner on consent withdrawal |

## Event ingest contract

```
POST /api/v1/events
Authorization: Bearer <integration_secret>
{
  "idempotency_key": "pika-assignment-abc123",
  "learner_id": "<pseudonymous_hashed_id>",
  "event_type": "assignment.completed",
  "occurred_at": "2026-06-25T10:00:00Z",
  "metadata": {
    "on_time": true
  }
}
```

Responses:
- `401` — missing or invalid integration secret
- `200 { "status": "processed", "mutations": [...] }` — rule engine ran, mutations applied. `mutations` is the full list the cascade applied, in order; the dev sandbox renders it.
- `200 { "status": "duplicate" }` — idempotency key already seen, no reprocessing
- `422` — unknown event type, disallowed metadata field, or a malformed/future-dated `occurred_at` (`future_occurred_at`: dated on a UTC day ahead of the server's, beyond a small clock-skew allowance — the streak engine is forward-only and a future day would freeze the learner's streak)

`event_type` must be on the integration's allow-list. Derived events (`XP_CHANGED`, `LEVEL_UP`, `STREAK_MILESTONE` — see [rule-engine.md](rule-engine.md)) are produced inside the engine cascade and are **never ingestable**: an integration that could POST `LEVEL_UP` could grant its own students levels. They are rejected with `422 unknown_event_type`.

---

> Full request/response schemas coming in Milestone 1.
