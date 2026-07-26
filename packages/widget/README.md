# `@pal/widget`

Portable React surfaces for Pal achievements, companion state, and rewards.

Import the package stylesheet once in the host application:

```tsx
import "@pal/widget/styles.css";
```

Then mount the public surfaces under one provider:

```tsx
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
  <PalRewardCelebration
    modal
    onOpenChange={setPalCelebrationOpen}
  />
</PalProvider>
```

The host owns placement. Pal owns everything rendered inside each component.
The package consumes scoped `--pal-*` semantic variables with portable defaults.
Import `PAL_THEME_PROPERTIES` from `@pal/widget/theme-contract` to validate a
host adapter without importing any Pal component or stylesheet.
See [`docs/widget-integration.md`](../../docs/widget-integration.md) for the full
boundary.
