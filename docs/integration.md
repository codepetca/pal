# Integration Guide

> Living document. Update as the integration API stabilizes.
> Last updated: 2026-07-21

---

## Target integration flow

1. Operator registers the integration in the admin console → receives a `secret`
2. Integration backend hashes student IDs before sending: `SHA256(salt + raw_student_id)`
3. Integration backend sends learning signals to `/api/v1/events`
4. On student page load, integration backend mints a short-lived learner-scoped read/embed token via `/api/v1/integration/read-token`
5. Integration frontend gives that token to a Pal client and renders the selected
   `@pal/widget` surfaces

The Pal client fetches achievement, pet, and world state directly from Pal. The
integration secret never leaves the backend.

Steps 4–5 are target M3 behavior, not an implemented API flow. The current prototype has no read-token minting route, and its learner-world endpoint does not yet enforce reader authorization. Do not use the prototype endpoint as a production embed boundary.

For Pika, the selected presentation is the native React package `@pal/widget`.
`PalAchievements` renders inside Pika's normal content pane. Pika separately mounts
`PalCompanion` and `PalRewardCelebration` in approved application-shell layers. A
future chrome-free `/embed/roadmap` route remains an option for hosts that cannot run
React; it is not Pika's primary presentation. See
[Selected Pika presentation boundary](pika-signal-adapter.md#selected-pika-presentation-boundary).

## Widget usage

```tsx
import {
  PalAchievements,
  PalCompanion,
  PalProvider,
  PalRewardCelebration,
  createPalHttpClient,
} from '@pal/widget'

const palClient = createPalHttpClient({
  apiBaseUrl,
  getAccessToken: mintLearnerScopedToken,
})

<PalProvider
  client={palClient}
  scopeKey={learnerSessionGeneration}
  theme={theme}
>
  <main><PalAchievements /></main>
  <aside><PalCompanion /></aside>
  <div><PalRewardCelebration /></div>
</PalProvider>
```

`PalProvider` shares authorization, learner state, refreshes, and error handling. The
three visible surfaces are separately mountable because their placement and lifecycle
differ. Pika owns the host containers and supplies a narrow semantic `--pal-*` theme
bridge; Pal owns their contents and behavior.

The package does not accept a raw learner ID, Pika user object, assignment data,
integration secret, or Pika component dependency. See
[Widget integration](widget-integration.md).

## Pika integration (first integration)

The event types below describe the current prototype contract. The target Pika adapter, normalized signal vocabulary, ownership boundary, duplicate semantics, and cross-project build checklist are documented in [Pika Signal Adapter and Achievement Pipeline](pika-signal-adapter.md).

Pika sends these event types:
- `assignment.completed` — on-time submissions carry `metadata.on_time: true`
- `daily_checkin.created`
- `resource.viewed`
- `calendar.month_end` (via schedule, not Pika API)
- `calendar.semester_end` (via schedule)

The developer control panel exposes assignment completion and daily check-in. The default rule pack also handles `calendar.month_end`; `resource.viewed` and `calendar.semester_end` are accepted legacy prototype types but currently have no default effect.

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
