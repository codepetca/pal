# Journey — 3D assignment roadmap viewer

A student viewer that renders a class as a sky of floating islands. Each island
is one student's roadmap through a shared course; click it and the camera flies
in, the island opens into a winding 3D path, and a Minecraft-style character
walks / runs / jumps along it to exactly where that student's progress stands.

Route: **`/viewer`**

## How it's built

- **React Three Fiber** (`@react-three/fiber`, `@react-three/drei`, `three`),
  client-only (`dynamic(..., { ssr: false })`).
- The **character** is a boxel Minecraft model built from a 64×64 skin PNG
  (from the `final-final-abhijit` LibGDX game). Skin UVs are mapped per-face in
  `lib/viewer/skin.ts`; animations are procedural, driven by pure functions in
  `lib/viewer/animation.ts` — the same "animations built in code" approach the
  original game uses.
- The **path** is generated from the assignment list, not hardcoded: a seeded
  winding layout (`lib/viewer/path-curve.ts`) sampled into a Catmull-Rom curve.
  The completed portion is lit, the rest is dim; the character sits at the
  progress point (`lib/viewer/progress.ts`).

## Data

`lib/viewer/demo-data.ts` holds a self-contained class of **pseudonymous**
students (no names/emails/real IDs) at varying progress. The data interface is
kept clean so it can later be fed from pal's `GET /api/v1/world/[learnerId]`
instead of the demo module — a data-source swap, not a rewrite.

## Read-only

The viewer never mutates learner state; it only draws a snapshot, so it respects
pal's rule that only the engine changes state.

## Layout

```
app/viewer/
  page.tsx                 route entry (client, no SSR)
  viewer.module.css        HUD / overlay styles
  _components/             R3F scene: ViewerApp, CameraRig, Overview/Expanded,
                           Island, Roadmap, AssignmentNode, MinecraftCharacter,
                           GradientSky
lib/viewer/                pure logic (progress, path-curve, animation) + tests,
                           skin builder, theme, demo data, types
public/viewer/skins/       skin PNGs
```

## Tests

Pure logic is unit-tested with `node:test`:

```
pnpm --filter @pal/web test
```
