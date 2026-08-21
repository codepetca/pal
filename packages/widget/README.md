# `@codepet/pal-widget`

Portable React surfaces for Pal achievements, companion state, and rewards.

Install the current prerelease with:

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
  PalCollection,
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
  <PalCollection />
  <PalCompanion />
  <PalRewardCelebration
    modal
    onOpenChange={setPalCelebrationOpen}
  />
</PalProvider>
```

The host owns placement. Pal owns everything rendered inside each component.
`PalCollection` renders the optional durable keepsakes in a v1 learner snapshot;
older snapshots without `collection` remain valid.

In standalone `modal` mode, `PalRewardCelebration` renders an absolute backdrop
that fills its nearest positioned ancestor, or the initial containing block when
there is none. Mount it in a positioned host layer when the modal should stay
within a specific application region.

Pass `effect="fireworks"` for a brief decorative burst behind achievement and
story artwork. The effect adds no content or interaction, restarts for each queued
reward, and is removed when the widget or operating system requests reduced motion.

Achievement celebrations are display-ready DTOs selected by Pal's authenticated
server. Each carries the earned achievement instance ID, stable achievement key,
canonical name, description, and badge presentation. The widget renders that DTO
directly and does not infer eligibility from roadmap state.

`PalCompanion` is the complete cat surface used by Pika and the sandbox. Hosts
may set its `scale` prop and attach pointer handlers without reaching into or
restyling Pal's internal artwork. The host owns any surrounding scenery or
background.
The package consumes scoped `--pal-*` semantic variables with portable defaults.

Hosts that already own a modal layer should derive its open state from
`usePalWidget().snapshot.rewards[0]`, acknowledge that reward from the host
layer's close handler with `dismissReward(reward.id)`, and render
`<PalRewardCelebration hostManaged />` inside it. In that mode `onOpenChange` is
intentionally ignored: the host owns the portal, dialog semantics, inert
background, focus containment, Escape behavior, scroll lock, and focus
restoration. Pal renders only the reward content and its acknowledgement action.
When the host modal supplies every pointer and keyboard dismissal path, pass
`hostManaged showDismissAction={false}` to remove the normal Continue button.
The option applies only to host-managed content, and Pal still renders a Retry
action if acknowledgement fails.
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
