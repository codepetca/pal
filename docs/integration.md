# Integration Guide

> Living document. Update as the integration API stabilizes.
> Last updated: 2026-07-21

---

## Target integration flow

1. Operator registers the integration in the admin console → receives a `secret`
2. Integration backend hashes student IDs before sending: `SHA256(salt + raw_student_id)`
3. Integration backend sends learning signals to `/api/v1/events`
4. On student page load, integration backend mints a short-lived learner-scoped read/embed token via `/api/v1/integration/read-token`
5. Integration frontend renders a Pal embed route or `@pal/widget` using that token

The embed/widget fetches achievement, pet, and world state directly from Pal. The integration secret never leaves the backend.

Steps 4–5 are target M3 behavior, not an implemented API flow. The current prototype has no read-token minting route, and its learner-world endpoint does not yet enforce reader authorization. Do not use the prototype endpoint as a production embed boundary.

For Pika, the selected initial presentation is Pal's chrome-free `/embed/roadmap` route inside Pika's normal content pane. The full roadmap is not a page-covering overlay. A compact pet and brief reward celebration may remain overlay elements. See [Selected Pika presentation boundary](pika-signal-adapter.md#selected-pika-presentation-boundary).

## Widget usage (later integration option)

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

The event types below describe the current prototype contract. The target Pika adapter, normalized signal vocabulary, ownership boundary, duplicate semantics, and cross-project build checklist are documented in [Pika Signal Adapter and Achievement Pipeline](pika-signal-adapter.md).

Pika sends these event types:
- `assignment.completed` — on-time submissions carry `metadata.on_time: true`
- `daily_checkin.created`
- `resource.viewed`
- `calendar.month_end` (via schedule, not Pika API)
- `calendar.semester_end` (via schedule)

Streaks are **not** sent by the integration. Pal derives them from `daily_checkin.created`: consecutive calendar days advance the streak, a missed day resets it. An integration cannot report a streak milestone, because an integration that could report one could also invent one.

## Adding a new integration

Any learning platform can integrate by:
1. Contacting the Pal operator to register
2. Agreeing to the pseudonymous ID spec and event allow-list
3. Installing `@pal/widget`
4. Implementing the three backend calls: ingest, read-token mint, and learner delete (for consent withdrawal)

An integration reports authoritative, privacy-safe learning facts. Pal owns achievement thresholds, recurrence, badge awards, and rewards; integrations do not report that an achievement was earned.

---

> SDK package and detailed setup flow coming in Milestone 3.
