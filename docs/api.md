# API Contracts

> Living document. Update as endpoints are finalized.
> Last updated: 2026-08-16

---

## Endpoints

| Method | Path | Who calls it | Purpose |
|---|---|---|---|
| POST | `/api/v1/events` | Integration backend | Ingest a learning signal |
| POST | `/api/v1/integration/read-token` | Integration backend | Mint a short-lived read token for a learner |
| GET | `/api/v1/learner/snapshot` | `@codepet/pal-widget` client | Fetch roadmap, companion, and unseen reward state |
| POST | `/api/v1/learner/rewards/:reward_id/seen` | `@codepet/pal-widget` client | Acknowledge one learner reward notice |
| GET | `/api/cron/story-collectibles` | Vercel Cron | Reconcile overdue post-rollout story ownership in bounded learner batches |
| POST | `/api/v1/admin/rule-preview` | Operator | Simulate an event against a rule pack |
| POST | `/api/v1/learner/delete` | Integration backend | Purge a learner on consent withdrawal |

The read-token, authenticated learner-snapshot, and reward acknowledgement routes are
implemented. The fixture client in `@codepet/pal-widget` powers visual development
and public PR previews; production and optional local persisted clients use these
learner routes.

### Scheduled story reconciliation

Vercel invokes `GET /api/cron/story-collectibles` with
`Authorization: Bearer <CRON_SECRET>`. Missing or malformed deployment
configuration returns `503`; an invalid bearer returns `401`. Successful runs
return `200` with batch, learner, retry, and grant counts. Discovery and each
learner transaction use bounded in-invocation retries. If an individual learner
still fails, the worker records only a sanitized failure code, attempt count,
and non-PII correlation identifier, continues the bounded batch, and returns
`500` with `status: "partial_failure"`. A later daily run rediscovers every
still-ungranted week.

The route does not accept a learner, period, date, or event payload. It derives
eligibility only from typed, indexed due-work materialized from validated stored
calendar configuration and immutable story-plan assignments. It creates no Pika
event, XP, activity, or achievement.

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
- unseen reward notices. Achievement notices include only the earned instance's
  stable key and canonical presentation-safe name, description, and badge.

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
- `200 { "status": "processed", "mutations": [...] }` — the fact was durably accepted and any eligible rule mutations were applied. A daily log received before configuration or beyond the current `eligible_days` allowance is accepted with no mutations and a durable pending marker; the first and every accepted higher configuration settle only the remaining allowance under the latest `eligible_days`, after validating source days. Each newly inserted exact-once settlement marker emits one internal flat-XP reward event. `mutations` is the full list the cascade applied, in order; the dev sandbox renders it.
- `200 { "status": "duplicate" }` — the idempotency key was already seen, or a second delivery identity asserted the same semantic fact (for example, another key for the same learner/activity date); no state is applied twice
- `422` — unknown event type, disallowed metadata field, an invalid revision to a closed Weekly Rhythm period (`closed_period_revision`), a closed configuration whose `eligible_days` is below the stored calendar-valid completion count (`contradictory_period_configuration`), a changed/duplicate authoritative term-week claim (`conflicting_period_calendar`), a story term outside 6–24 weeks or a week position outside that term (`invalid_term_story_schedule`), exhausted daily-log capacity (five qualifying days, five unclassified pre-configuration facts, or ten retained qualifying-plus-quarantined facts) (`daily_log_period_limit_exceeded`), an instant beyond the one-hour clock-skew allowance (`future_occurred_at`), a daily-log date impossible at that instant anywhere from UTC−12 through UTC+14 (`implausible_activity_day`), or a source day that disagrees with the configured term timezone or falls outside its bound instructional week (`inconsistent_activity_day`)

`event_type` must be on the integration's allow-list. Synthetic events (`XP_CHANGED`, `LEVEL_UP`, `STREAK_MILESTONE`, `DAILY_LOG_REWARD_SETTLED` — see [rule-engine.md](rule-engine.md)) are produced inside the engine or persistence cascade and are **never ingestable**: an integration that could POST one could grant its own students progression. They are rejected with `422 unknown_event_type`.

---

> Version 1 request schemas are implemented in [@pal/contract](../packages/contract/README.md).
> Response schemas are still prose above.
