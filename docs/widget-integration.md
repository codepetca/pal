# Pal widget integration

`@codepet/pal-widget` is Pal's selected presentation boundary for Pika. It is one React
package with three separately mountable learner surfaces sharing a provider:

- `PalAchievements` — the complete vertical roadmap in Pika's content pane.
- `PalCompanion` — a small ambient pet surface in a host-approved layer.
- `PalRewardCelebration` — dismissible, reduced-motion-aware reward content in a
  host-approved layer. In standalone mode Pal owns dialog/focus behavior; Pika uses
  host-managed mode so its canonical modal layer owns that behavior.

The separation is intentional. The roadmap is route content; the companion may
outlive that route; a celebration has a one-time notification lifecycle. They share
authorization, cached learner state, refreshes, and errors through `PalProvider`.
Packaging and alpha publication are documented in
[Pal widget release](widget-release.md).

## Public boundary

```tsx
const client = createPalHttpClient({
  apiBaseUrl,
  getAccessToken: mintLearnerScopedToken,
  allowedAssetOrigins: ["https://assets.pal.example"],
})

<PalProvider
  client={client}
  scopeKey={learnerSessionGeneration}
  theme="light"
  density="comfortable"
  viewport="wide"
  motion="system"
>
  <PalAchievements />
  <PalCompanion />
  <PikaModalLayer
    isOpen={Boolean(palReward)}
    onClose={() => palReward && void dismissReward(palReward.id)}
    ariaLabel="Reward earned"
  >
    <PalRewardCelebration hostManaged />
  </PikaModalLayer>
</PalProvider>
```

The public client returns a versioned learner snapshot. The widget renders stored
Pal state; it never interprets Pika events or calculates achievement progress in the
browser.

`PalCompanion` is the complete cat-on-grass visual surface.
Pal owns its artwork, animation, internal sizing, and transparent-pixel hit testing.
The host may set `scale` and attach standard pointer handlers, but owns the containing
layer, viewport placement, drag persistence, and collision rules. The sandbox follows
this same boundary; it does not reconstruct or restyle the companion's internals.

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

Pal allows credentialed widget reads only from exact origins configured in
`PAL_ALLOWED_WIDGET_ORIGINS`. Wildcards, path-bearing values, insecure non-local
origins, and unlisted browser origins are rejected. Learner responses are never cached.

`apiBaseUrl` must use HTTPS, except for credential-free localhost development.
Custom snapshot and reward paths must resolve to that same API origin; the client
validates the destination before requesting or attaching a learner token.

Snapshot asset URLs are restricted to the Pal API origin by default. A Pal-owned
CDN must be explicitly named in `allowedAssetOrigins`; insecure protocols and
unlisted third-party origins are rejected before the snapshot enters React state.

Standalone hosts may set `modal` and use `onOpenChange` to coordinate their own
backdrop and inert application region; Pal then contains Tab focus, handles Escape,
and restores focus. Pika instead derives open state from
`usePalWidget().snapshot.rewards[0]`, calls `dismissReward(reward.id)` from every
host close path, and renders `hostManaged` reward content inside `ModalLayer`.
`ModalLayer` owns the portal, dialog label and semantics, inert background, focus
containment/restoration, Escape, backdrop policy, and scroll lock. In host-managed
mode Pal intentionally does not publish `onOpenChange` or run competing focus and
keyboard behavior.

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
- host-managed reward dialog semantics, focus, Escape, inertness, and scroll lock;
- the learner-token callback;
- semantic host tokens, theme, focus expectations, and reduced-motion setting; and
- failure containment so Pal cannot block academic work.

Pal owns:

- roadmap, achievement, badge, pet, and reward rendering;
- the companion's cat-and-grass composition and internal hit boundary;
- component accessibility inside each Pal surface;
- learner snapshot types and refresh semantics;
- asset resolution; and
- fixture and real HTTP client implementations.

## Theme contract

Theme contract version 1 is exported from `@codepet/pal-widget/theme-contract` as
`PAL_THEME_CONTRACT_VERSION`, `PAL_THEME_PROPERTIES`, and
`PAL_THEME_ATTRIBUTES`. This is the machine-readable boundary hosts should use
for adapter drift checks.

Widget CSS uses only scoped semantic variables with portable fallbacks. A host
may omit every variable and still get a usable light or dark widget. Pika maps
all properties because it wants native visual continuity:

```css
.pal-widget-host {
  --pal-color-page: var(--color-page);
  --pal-color-surface: var(--color-surface);
  --pal-color-surface-muted: var(--color-surface-2);
  --pal-color-surface-selected: var(--color-surface-selected);
  --pal-color-border: var(--color-border);
  --pal-color-border-strong: var(--color-border-strong);
  --pal-color-text: var(--color-text-default);
  --pal-color-text-muted: var(--color-text-muted);
  --pal-color-text-inverse: var(--color-text-inverse);
  --pal-color-primary: var(--color-primary);
  --pal-color-primary-solid: var(--color-primary-solid);
  --pal-color-primary-solid-hover: var(--color-primary-solid-hover);
  --pal-color-success: var(--color-success);
  --pal-color-success-bg: var(--color-success-bg);
  --pal-color-warning: var(--color-warning);
  --pal-color-warning-bg: var(--color-warning-bg);
  --pal-font-family-ui: var(--font-family-ui);
  --pal-radius-control: var(--radius-control);
  --pal-radius-card: var(--radius-card);
  --pal-shadow-panel: var(--shadow-panel);
  --pal-focus-color: var(--focus-ring-color);
  --pal-focus-width: var(--focus-ring-width);
  --pal-focus-offset: var(--focus-ring-offset);
  --pal-motion-duration-fast: var(--motion-duration-fast);
  --pal-motion-duration-standard: var(--motion-duration-standard);
  --pal-motion-duration-deliberate: var(--motion-duration-deliberate);
  --pal-motion-easing-standard: var(--motion-easing-standard);
  --pal-size-control-min: var(--size-control-min);
  --pal-space-card: var(--space-card);
  --pal-space-control: var(--space-control);
  --pal-density-compact-gutter: var(--density-compact-gutter);
  --pal-density-compact-content-top: var(--density-compact-content-top);
  --pal-density-compact-stack: var(--density-compact-stack-gap);
  --pal-density-comfortable-gutter: var(--density-comfortable-gutter);
  --pal-density-comfortable-content-top: var(--density-comfortable-content-top);
  --pal-density-comfortable-stack: var(--density-comfortable-stack-gap);
}
```

The widget inherits the host font and maps the optional font-family property.
`theme`, `density`, `viewport`, and `motion` become scoped `data-pal-*`
attributes on each public surface. Pika therefore communicates its layout mode
explicitly; Pal does not inspect a Pika route, role, Tailwind breakpoint, or
global theme class.

`viewport="narrow"` changes only responsive composition. `density` changes
spacing, never information or behavior. `motion="reduced"` disables decorative
animation; `motion="system"` follows `prefers-reduced-motion`.

Pal-specific art, illustration, gradients, badge identity, and reward colors
remain Pal-owned, while all status meaning also uses text and icons. The
components have no fixed, sticky, portal, or `document.body` placement behavior:
the host owns companion and celebration layers and their clearances.

## Sandbox contract

Pal's sandbox imports only the package's public exports. It contains:

- a minimal host shell with content and overlay layers;
- light, dark, wide, and narrow host scenarios;
- the package's authenticated HTTP client, using a sandbox-only learner-token exchange;
- the compact fictional-semester control panel; and
- all six v1 facts injected through Pal's real API, plus short-week revision,
  duplicate replay, and reset controls.

The control panel is an application-development tool and is not exported from the
widget package. Controls pass through validation, deduplication, persistence,
achievement evaluation, award/reward persistence, the learner snapshot API, and the
reward acknowledgement API. The package fixture client remains available for isolated
component tests; it is not the sandbox's source of learner state.

Stateful sandbox routes are local-only by default. Preview use is fail-closed and may
be enabled only with `PAL_SANDBOX_PROTECTED_PREVIEW=true`, upstream deployment
authentication, and an isolated, disposable preview database.

## Initial acceptance

- The sandbox consumes `@codepet/pal-widget` through public package exports.
- Roadmap, companion, and celebration can mount and fail independently.
- All surfaces render in light and dark modes and inherit host typography.
- Status is never conveyed by color alone.
- Controls retain visible focus and a 44px minimum target.
- Celebration has a dismiss control and a reduced-motion treatment.
- No integration secret or raw learner identifier enters the package.
- The control log reports the receiver's real processed/duplicate result.
