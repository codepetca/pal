# Pal widget integration

`@pal/widget` is Pal's selected presentation boundary for Pika. It is one React
package with three separately mountable learner surfaces sharing a provider:

- `PalAchievements` — the complete vertical roadmap in Pika's content pane.
- `PalCompanion` — a small ambient pet surface in a host-approved layer.
- `PalRewardCelebration` — a dismissible, reduced-motion-aware reward surface in a
  host-approved layer.

The separation is intentional. The roadmap is route content; the companion may
outlive that route; a celebration has a one-time notification lifecycle. They share
authorization, cached learner state, refreshes, and errors through `PalProvider`.

## Public boundary

```tsx
const client = createPalHttpClient({
  apiBaseUrl,
  getAccessToken: mintLearnerScopedToken,
})

<PalProvider
  client={client}
  scopeKey={learnerSessionGeneration}
  theme="light"
>
  <PalAchievements />
  <PalCompanion />
  <PalRewardCelebration />
</PalProvider>
```

The public client returns a versioned learner snapshot. The widget renders stored
Pal state; it never interprets Pika events or calculates achievement progress in the
browser.

The package may receive:

- a Pal client or the inputs needed to create one;
- `light` or `dark` appearance;
- an optional refresh interval and error callback; and
- host-owned containers around its separately mounted surfaces.

The package never receives:

- a raw learner ID, email, name, grade, assignment, deadline, or student work;
- a Pika session cookie or integration secret;
- Pika database or route objects; or
- Pika components or private application state.

The browser receives only a short-lived learner-scoped token. Pal's integration
secret stays on Pika's backend.

`scopeKey` is a host-local opaque value that changes synchronously before the active
learner context changes. Pal never transmits it. This prevents a previous learner's
cached snapshot from appearing while a new learner loads; it must not be a name,
email, raw learner ID, or other personal data.

The provider aborts snapshot and reward-acknowledgement work whenever `scopeKey` or
the client changes. The token callback receives the same optional `AbortSignal`, so
a request started for one learner cannot continue through token acquisition after
the host commits a different learner. Reward acknowledgement is retry-safe and
idempotent on Pal's API.

## Host and Pal ownership

Pika owns:

- whether and where each surface mounts;
- application shell, navigation, page width, and overlay boundaries;
- the learner-token callback;
- semantic host tokens, theme, focus expectations, and reduced-motion setting; and
- failure containment so Pal cannot block academic work.

Pal owns:

- roadmap, achievement, badge, pet, and reward rendering;
- component accessibility inside each Pal surface;
- learner snapshot types and refresh semantics;
- asset resolution; and
- fixture and real HTTP client implementations.

## Theme contract

Widget CSS uses only scoped semantic variables with portable fallbacks:

```css
.pal-widget-host {
  --pal-color-page: var(--color-page);
  --pal-color-surface: var(--color-surface);
  --pal-color-surface-muted: var(--color-surface-2);
  --pal-color-border: var(--color-border);
  --pal-color-text: var(--color-text-default);
  --pal-color-text-muted: var(--color-text-muted);
  --pal-color-primary: var(--color-primary);
  --pal-radius-card: var(--radius-card);
  --pal-shadow-panel: var(--shadow-panel);
}
```

The exact Pika aliases are finalized through Pika's design-system consolidation.
The widget inherits typography from its host. Pal-specific art, illustration, and
reward colors remain Pal-owned, while all status meaning also uses text and icons.

## Sandbox contract

Pal's sandbox imports only the package's public exports. It contains:

- a minimal host shell with content and overlay layers;
- light, dark, wide, and narrow host scenarios;
- a clearly labeled fixture client for visual-state development;
- the compact fictional-semester control panel; and
- a pipeline mode, once implemented, that injects v1 events through Pal's real API.

The control panel is an application-development tool and is not exported from the
widget package. Fixture actions may update only the fixture client. Pipeline actions
must pass through validation, deduplication, persistence, achievement evaluation,
award/reward persistence, and the learner read API.

## Initial acceptance

- The sandbox consumes `@pal/widget` through public package exports.
- Roadmap, companion, and celebration can mount and fail independently.
- All surfaces render in light and dark modes and inherit host typography.
- Status is never conveyed by color alone.
- Controls retain visible focus and a 44px minimum target.
- Celebration has a dismiss control and a reduced-motion treatment.
- No integration secret or raw learner identifier enters the package.
- Fixture mode is visibly distinct from proof of the real event pipeline.
