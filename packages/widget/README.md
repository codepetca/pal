# `@pal/widget`

Portable React surfaces for Pal achievements, companion state, and rewards.

Import the package stylesheet once in the host application:

```tsx
import "@pal/widget/styles.css";
```

Then mount the public surfaces under one provider:

```tsx
<PalProvider client={client} theme="light">
  <PalAchievements />
  <PalCompanion />
  <PalRewardCelebration />
</PalProvider>
```

The host owns placement. Pal owns everything rendered inside each component.
The package consumes scoped `--pal-*` semantic variables with portable defaults.
See [`docs/widget-integration.md`](../../docs/widget-integration.md) for the full
boundary.
