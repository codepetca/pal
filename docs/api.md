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

Two versions travel in one request and mean different things. The `v1` in the path
versions the **API surface** — auth scheme, which endpoints exist, the error envelope.
The `schema_version` in the body versions the **payload** for a single event. They move
independently; see [@pal/contract](../packages/contract/README.md#versioning).

### Version 1 payloads (target)

Machine-readable schemas, types, and shared test fixtures live in
[`packages/contract`](../packages/contract/README.md). That package is the source of
truth; the tables in [pika-signal-adapter.md](pika-signal-adapter.md) explain it.

```
POST /api/v1/events
Authorization: Bearer <integration_secret>
{
  "schema_version": 1,
  "idempotency_key": "pika:assignment:opaque-item-token:completed",
  "learner_id": "<pseudonymous_token>",
  "event_type": "learning_item.completed",
  "occurred_at": "2026-09-16T18:20:00Z",
  "metadata": {
    "item_token": "opaque-item-token",
    "kind": "assignment",
    "period_key": "2026-fall-week-03",
    "timing": "on_time"
  }
}
```

Ingest does not accept this shape yet — the contract package landed first so that both
sides can build against it. Wiring it into the route is the follow-up.

### Legacy prototype payloads (current)

Sent without `schema_version`. Still the only shape ingest accepts today.

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

> Version 1 request schemas are implemented in [@pal/contract](../packages/contract/README.md).
> Response schemas are still prose above.
