# `@codepet/pal-widget`

Portable React surfaces for Pal achievements, companion state, and rewards.

Once the first prerelease is published, install it with:

```bash
pnpm add @codepet/pal-widget@alpha
```

Import the package stylesheet once in the host application:

```tsx
import "@codepet/pal-widget/styles.css";
```

Then mount the public surfaces under one provider:

```tsx
import {
  PalAchievements,
  PalCompanion,
  PalProvider,
  PalRewardCelebration,
} from "@codepet/pal-widget";

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

Hosts that already own a modal layer should render
`<PalRewardCelebration hostManaged />` inside it. In that mode the host owns the
portal, dialog semantics, inert background, focus containment, Escape behavior,
scroll lock, and focus restoration; Pal renders only the reward content and its
acknowledgement action.
Import `PAL_THEME_PROPERTIES` from
`@codepet/pal-widget/theme-contract` to validate a host adapter without importing
any Pal component or stylesheet.
See the
[widget integration guide](https://github.com/codepetca/pal/blob/main/docs/widget-integration.md)
for the full boundary.

The package is currently prepared as an `alpha` prerelease. Publication is a
separate owner action; see the
[release guide](https://github.com/codepetca/pal/blob/main/docs/widget-release.md).

Licensed under the [MIT License](./LICENSE).
