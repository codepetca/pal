# Integration Guide

> Living document. Update as the integration API stabilizes.
> Last updated: 2026-06-25

---

## How an integration works

1. Operator registers the integration in the admin console → receives a `secret`
2. Integration backend hashes student IDs before sending: `SHA256(salt + raw_student_id)`
3. Integration backend sends learning signals to `/api/v1/events`
4. On student page load, integration backend mints a short-lived read token via `/api/v1/integration/read-token`
5. Integration frontend renders the `@pal/widget` using that token

The widget fetches pet and world state directly from Pal. The integration secret never leaves the backend.

## Widget usage

```tsx
import { PalWidget } from '@pal/widget'

<PalWidget
  readToken={tokenFromYourBackend}
  learnerId={pseudonymousId}
  theme="pika"
  onUnlock={(unlock) => showToast(unlock.name)}
/>
```

## Pika integration (first integration)

Pika sends these event types:
- `learning_item.completed` — `metadata.timing` is `"on_time"` or `"late"`
- `learning_item.viewed`
- `daily_log.completed`
- `daily_log_week.configured` (via schedule) — `metadata.eligible_days` (`0`–`5`), `period_status` (`open`/`closed`)
- `platform.session.started`
- `classroom.joined`

Streaks are **not** sent by the integration. Pal derives them from `daily_log.completed`: consecutive calendar days advance the streak, a missed day resets it. An integration cannot report a streak milestone, because an integration that could report one could also invent one.

## Adding a new integration

Any learning platform can integrate by:
1. Contacting the Pal operator to register
2. Agreeing to the pseudonymous ID spec and event allow-list
3. Installing `@pal/widget`
4. Implementing the three backend calls: ingest, read-token mint, and learner delete (for consent withdrawal)

---

> SDK package and detailed setup flow coming in Milestone 3.
