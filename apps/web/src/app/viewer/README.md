# SkyBlock Classroom — voxel progress islands

A student viewer where each student's progress is a **floating voxel island**
that grows as they complete assignments. Pick a student from the roster to visit
their island; complete an assignment to grow the island (with a block-pop
flourish), or miss a deadline to call down an asteroid that craters it.

Route: **`/viewer`**

## The look

Real Minecraft rendering, ported from the "SkyBlock Classroom" three.js
prototype into this app:

- **Unlit vanilla shading**: blocks use `MeshBasicMaterial` (no dynamic lights)
  with per-face brightness × **per-vertex smooth-lighting / ambient occlusion**
  recomputed on every world change — the same model the game uses.
- **Real block textures** (grass/dirt/stone/logs/leaves/flowers), grass tints
  composited on a canvas, `NearestFilter` for crisp pixels.
- **Seeded terrain**: value-noise fBm + an archipelago mask, generated ring by
  ring, so every student's island is unique and stable (seed = student id).
- Oak & cherry trees, cross-plane plants, a gradient sky dome, drifting clouds,
  falling petals, block-break particles, and the classic procedural fire.

The Minecraft character (built from a 64×64 skin, `lib/viewer/skin.ts`) stands
on the island; it uses a lit material, so the scene adds lights just for it —
the unlit blocks ignore them.

## Progress → island

`ringsFor(completedCount)` maps a student's progress to how many rings of
terrain are pre-generated, so more progress ⇒ a bigger island. Completing an
assignment live calls `expandIsland` (grow outward); missing one calls
`launchAsteroid` (crater + fire).

## Data & privacy

`lib/viewer/demo-data.ts` — a self-contained class of **pseudonymous** students
(no names/emails/real IDs) at varying progress. The viewer is **read-only** and
mutates no learner state.

## Layout

```
app/viewer/
  page.tsx                 route entry (client, no SSR)
  viewer.module.css        HUD styles (title, roster, progress, actions)
  _components/
    ViewerApp.tsx          shell: Canvas + roster + HUD + interactions
    VoxelWorld.tsx         R3F host — builds sky/island/clouds, drives effects
    CameraFrame.tsx        frames the camera to the island's size
    MinecraftCharacter.tsx boxel character from a skin
lib/viewer/
    voxel-world.ts         the ported engine (textures, terrain, AO, effects)
    skin.ts, animation.ts  character model + procedural animation (unit-tested)
    progress.ts            progress math (unit-tested)
    demo-data.ts, types.ts
public/viewer/
    textures/blocks/*.png  Minecraft block textures
    sounds/*.ogg           pop / dig / explode
    skins/*.png            character skins
```

## Tests

`pnpm --filter @pal/web test` — pure logic (progress + animation) via `node:test`.
