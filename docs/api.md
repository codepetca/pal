# API Contracts

> Living document. Update as endpoints are finalized.
> Last updated: 2026-06-25

---

## Endpoints (planned)

| Method | Path | Who calls it | Purpose |
|---|---|---|---|
| POST | `/v1/events` | Integration backend | Ingest a learning signal |
| GET | `/v1/world/:learner_id` | Widget (via read token) | Fetch pet + world state |
| POST | `/v1/integration/read-token` | Integration backend | Mint a short-lived read token for a learner |
| POST | `/v1/admin/rule-preview` | Operator | Simulate an event against a rule pack |
| POST | `/v1/learner/delete` | Integration backend | Purge a learner on consent withdrawal |

## Event ingest contract

```
POST /v1/events
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
- `200 { "status": "processed" }` — rule engine ran, mutations applied
- `200 { "status": "duplicate" }` — idempotency key already seen, no reprocessing
- `422` — unknown event type or disallowed metadata field

---

> Full request/response schemas coming in Milestone 1.
