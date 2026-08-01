# Integration Guide

> Living document. Update as the integration API stabilizes.
> Last updated: 2026-08-01

---

## Target integration flow

1. Operator registers the integration in the admin console → receives a `secret`
2. Integration backend hashes student IDs before sending: `SHA256(salt + raw_student_id)`
3. Integration backend sends learning signals to `/api/v1/events`
4. On student page load, integration backend mints a short-lived learner-scoped read/embed token via `/api/v1/integration/read-token`
5. Integration frontend gives that token to a Pal client and renders the selected
   `@codepet/pal-widget` surfaces

The Pal client fetches achievement, pet, and world state directly from Pal. The
integration secret never leaves the backend.

Steps 4 and 5 are implemented on Pal's API boundary: Pal authenticates Pika's backend,
mints a five-minute token whose subject is Pal's internal learner UUID, serves the
token-scoped roadmap/companion/reward snapshot, and acknowledges reward presentation
idempotently. Pika still needs to install the published package and mount the native
surfaces. The legacy learner-world endpoint does not enforce production reader
authorization and must not be used as an integration boundary.

For Pika, the selected presentation is the native React package `@codepet/pal-widget`.
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
  usePalWidget,
} from '@codepet/pal-widget'

const palClient = createPalHttpClient({
  apiBaseUrl,
  getAccessToken: mintLearnerScopedToken,
})

function PikaPalSurfaces() {
  const { dismissReward, snapshot } = usePalWidget()
  const reward = snapshot?.rewards[0]

  return <>
    <main><PalAchievements /></main>
    <aside><PalCompanion /></aside>
    <PikaModalLayer
      isOpen={Boolean(reward)}
      onClose={() => reward && void dismissReward(reward.id)}
      ariaLabel="Reward earned"
    >
      <PalRewardCelebration hostManaged />
    </PikaModalLayer>
  </>
}

<PalProvider client={palClient} scopeKey={learnerSessionGeneration} theme={theme}>
  <PikaPalSurfaces />
</PalProvider>
```

`PalProvider` shares authorization, learner state, refreshes, and error handling. The
three visible surfaces are separately mountable because their placement and lifecycle
differ. Pika owns the host containers and supplies a narrow semantic `--pal-*` theme
bridge; Pal owns their contents. Pika derives reward-modal visibility from the first
pending reward and acknowledges that reward through `dismissReward` from every close
path. Pika's canonical `ModalLayer` owns the portal, dialog semantics, inertness,
focus, Escape/backdrop policy, and scroll lock; `PalRewardCelebration hostManaged`
does not compete for those behaviors.

The package does not accept a raw learner ID, Pika user object, assignment data,
integration secret, or Pika component dependency. See
[Widget integration](widget-integration.md).

Configure every exact Pika browser origin in Pal's
`PAL_ALLOWED_WIDGET_ORIGINS`. Pal rejects other browser origins before token
verification and never uses a wildcard credentialed CORS policy.

## Pika integration (first integration)

The normalized signal vocabulary, ownership boundary, duplicate semantics, and
cross-project build checklist are documented in
[Pika Signal Adapter and Achievement Pipeline](pika-signal-adapter.md).

Pika sends the six version 1 facts defined by `@pal/contract`: authenticated session,
classroom join, weekly daily-log configuration, daily-log completion, learning-item
view, and learning-item completion. Streaks and achievements are never sent by the
integration; Pal derives them from accepted facts.

## Adding a new integration

Any learning platform can integrate by:
1. Contacting the Pal operator to register
2. Agreeing to the pseudonymous ID spec and event allow-list
3. Installing `@codepet/pal-widget`
4. Implementing the three backend calls: ingest, read-token mint, and learner delete (for consent withdrawal)

An integration reports authoritative, privacy-safe learning facts. Pal owns achievement thresholds, recurrence, badge awards, and rewards; integrations do not report that an achievement was earned.

---

> Publishing `@codepet/pal-widget` for general integrations and the detailed production
> setup flow remain Milestone 3 work.
