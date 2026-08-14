# API Contracts

> Living document. Update as endpoints are finalized.
> Last updated: 2026-08-01

---

## Endpoints

| Method | Path | Who calls it | Purpose |
|---|---|---|---|
| POST | `/api/v1/events` | Integration backend | Ingest a learning signal |
| POST | `/api/v1/integration/read-token` | Integration backend | Mint a short-lived read token for a learner |
| GET | `/api/v1/learner/snapshot` | `@codepet/pal-widget` client | Fetch roadmap, companion, and unseen reward state |
| POST | `/api/v1/learner/rewards/:reward_id/seen` | `@codepet/pal-widget` client | Acknowledge one learner reward notice |
| POST | `/api/v1/admin/rule-preview` | Operator | Simulate an event against a rule pack |
| POST | `/api/v1/learner/delete` | Integration backend | Purge a learner on consent withdrawal |

The read-token, authenticated learner-snapshot, and reward acknowledgement routes are
implemented. The fixture client in `@codepet/pal-widget` powers visual development
and public PR previews; production and optional local persisted clients use these
learner routes.

### Read-token request

```text
POST /api/v1/integration/read-token
Authorization: Bearer <integration_secret>
Content-Type: application/json

{ "learner_id": "<pseudonymous_token>" }
```

The request accepts no other fields. Pal resolves or creates only the integration-scoped
learner identity and returns a five-minute signed token plus `expires_at`. The response
uses `Cache-Control: no-store`. Its subject is Pal's internal learner UUID; the external
pseudonymous token is not placed in the browser token. Tokens are restricted to the Pal
issuer, `pal-widget` audience, authenticated integration, learner, and the
`learner:read` / `reward:ack` scopes.

## Widget read contract

The browser calls learner routes with:

```text
Authorization: Bearer <short-lived learner-scoped read token>
```

Cross-origin browser requests are accepted only when their exact HTTPS origin appears
in `PAL_ALLOWED_WIDGET_ORIGINS` (HTTP is allowed only for localhost development).
Responses use `Cache-Control: no-store`; preflights allow only `Authorization`,
`Content-Type`, and the learner route methods.

The public TypeScript source of truth for the initial snapshot is
[`packages/widget/src/types.ts`](../packages/widget/src/types.ts). The snapshot is
versioned independently from event ingestion and includes:

- the authoritative 6–24-week term roadmap and stored achievement state (16 weeks for legacy producers);
- current companion state; and
- unseen reward notices.

The widget receives no raw learner identifier. Pika's backend uses its integration
credential to mint the learner-scoped token; that credential never enters the
browser. Acknowledging a reward notice changes notification presentation only and
must not reapply or mutate the underlying award. The acknowledgement endpoint is
idempotent for a learner-scoped reward ID: every repeat `POST` returns success as a
no-op, including a retry after the original response was lost. A repeat must never
replay the award, celebration, analytics, or any other side effect.

## Event ingest contract

Two versions travel in one request and mean different things. The `v1` in the path
versions the **API surface** — auth scheme, which endpoints exist, the error envelope.
The `schema_version` in the body versions the **payload** for a single event. They move
independently; see [@pal/contract](../packages/contract/README.md#versioning).

### Version 1 payloads

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

Responses:
- `401` — missing or invalid integration secret
- `200 { "status": "processed", "mutations": [...] }` — rule engine ran, mutations applied. `mutations` is the full list the cascade applied, in order; the dev sandbox renders it.
- `200 { "status": "duplicate" }` — the idempotency key was already seen, or a second delivery identity asserted the same semantic fact (for example, another key for the same learner/activity date); no state is applied twice
- `422` — unknown event type, disallowed metadata field, an invalid revision to a closed Weekly Rhythm period (`closed_period_revision`), a closed configuration whose `eligible_days` is below the stored completion count (`contradictory_period_configuration`), a changed/duplicate authoritative term-week claim (`conflicting_period_calendar`), a malformed/future-dated `occurred_at` (`future_occurred_at`: dated on a UTC day ahead of the server's, beyond a small clock-skew allowance), or a daily log whose source day is implausibly far ahead (`future_activity_day`)

`event_type` must be on the integration's allow-list. Derived events (`XP_CHANGED`, `LEVEL_UP`, `STREAK_MILESTONE` — see [rule-engine.md](rule-engine.md)) are produced inside the engine cascade and are **never ingestable**: an integration that could POST `LEVEL_UP` could grant its own students levels. They are rejected with `422 unknown_event_type`.

---

> Version 1 request schemas are implemented in [@pal/contract](../packages/contract/README.md).
> Response schemas are still prose above.
