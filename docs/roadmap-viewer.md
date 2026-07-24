# Roadmap Viewer — complete reference

The gamified student viewer at **`/viewer`** (Duolingo-style winding path). Everything on screen is a pure function of one JSON object (`RoadmapData`). Nothing about the path, nodes, chests, or rewards is hardcoded — swap the data and the whole board re-renders.

- **Route:** `apps/web/src/app/viewer/page.tsx` → `<Dashboard data={sampleRoadmap} />`
- **Module:** `apps/web/src/roadmap/` (public API in `index.ts`)
- **Demo data:** `apps/web/src/roadmap/sample-data.ts`

---

## 1. How it works (data flow)

```
RoadmapData (backend / sample-data)
      │  useState(initial)
      ▼
  Dashboard  ── owns ALL runtime state ──┐
      │                                   │  selected node · editing · celebrate
      │  track = data.tracks[0]           │  reveal (chest) · collectedIds
      ▼                                   ▼
  RoadmapView → layout.ts (pure geometry) → Node/banner/spine
      │
  progress.ts (pure engine): completeNode · openChest · normalize · readyChestIds · pickCollectable
```

`Dashboard` is the only stateful component. Every action produces a **new** `RoadmapData`/`Track` via the pure engine in `progress.ts`, then `setData` re-renders. `RoadmapView`, `Node`, `layout.ts`, and `progress.ts` are pure — no side effects, no DOM.

---

## 2. Backend variables (the data model)

All of these live in `types.ts` and are meant to come from your backend (today they come from `sample-data.ts`). None are hardcoded in components.

### `RoadmapData`
| Field | Type | Notes |
|---|---|---|
| `tracks` | `Track[]` | The viewer renders `tracks[0]`. |

### `Track`
| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `name` | `string` | |
| `accent` | `string` (hex) | Accent color. |
| `subtitle?` | `string` | |
| `learner` | `Learner` | Progress/economy for this learner. |
| `leaderboard?` | `LeaderboardEntry[]` | Not shown in the current viewer. |
| `units` | `Unit[]` | Ordered; render top→bottom. |
| `collectables?` | `Collectable[]` | **Reward pool** for this track's chests. |

### `Learner`
`level`, `rank`, `xp`, `xpToNext`, `streak`, `gems`, `week: boolean[]`. The viewer shows `xp` in the dock; `completeNode` increments `xp` and `gems`.

### `Unit`
| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `kind` | `string` | Eyebrow, e.g. `"Unit 1"`. |
| `title` | `string` | Banner title. |
| `subtitle?` | `string` | |
| `color` | `string` (hex) | Banner color + spine tint. |
| `icon` | `NodeType` | Banner glyph. |
| `nodes` | `RoadmapNode[]` | Ordered assignments/chests/etc. |

### `RoadmapNode` — the assignment
| Field | Type | Notes |
|---|---|---|
| `id` | `string` | **The completion key.** The backend completes *this id*. |
| `type` | `NodeType` | `assignment \| log \| chest \| project \| test`. Drives size/color/icon via `NODE_STYLE`. |
| `title` | `string` | Node label. |
| `xp` | `number` | Awarded on completion. |
| `status` | `NodeStatus` | `done \| current \| locked`. Runtime re-derives `current`/`locked`; only `done` is authoritative. |
| `crown?` | `number` | Mastery 0–3 → crown badge. |
| `description?` | `string` | Shown in the detail modal (falls back to the type blurb in `NODE_STYLE`). |
| `href?` | `string` | Link to the real assignment page (modal "Open assignment page"). Optional — omit for no link. |
| `icon?` | `string` | Custom icon override: an icon name, an emoji, or an image URL (`http`, `/path`, `data:`). Falls back to the type icon (chests fall back to the chest art). |
| `meta?` | `Record<string, string\|number\|boolean>` | Free-form. **No PII** (see CLAUDE.md). |

### `Collectable` — a chest reward
| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Dedup key — one per learner, ever. |
| `name` | `string` | Shown on reveal + tray tooltip. |
| `icon` | `string` | Emoji, image URL, or an uploaded image stored as a `data:` URL. |

### `NodeType` / `NodeStatus`
```ts
type NodeType   = "assignment" | "log" | "chest" | "project" | "test";
type NodeStatus = "done" | "current" | "locked";
```

---

## 3. What IS hardcoded (the small constants)

Everything else is data. These are the deliberate constants — change them here, not per-node:

| Constant | File | What it controls |
|---|---|---|
| `NODE_STYLE` | `node-styles.ts` | Per-type color (`top`/`edge`), diameter (`size`), press depth, boss flag, default blurb. Add a node type here in one place. |
| `DEFAULTS` + sine `* 1.2` | `layout.ts` | Path geometry: column `width` 540, `amplitude` 176, `gap` 68, banner sizing; the `1.2` sets how tightly the path snakes. |
| `PRAISES` | `Achievement.tsx` | Random celebration headlines (`Great job!`, `Awesome!`, …). |
| `CHEST_CLOSED` / `CHEST_OPEN` | `Node.tsx` | Chest art paths (`/chest-closed.png`, `/chest-open.png`). |
| `.bg` background | `Dashboard.module.css` | Full-bleed photo `/roadmap-bg.jpg` + dark scrim + gradient fallback. |

---

## 4. Completion model (non-linear, backend-driven)

**Rule: the only thing that marks a node done is a completion event for a specific id.** This mirrors the backend — the frontend never invents progress.

- **Per-node.** `completeNode(track, id)` (`progress.ts`) marks *that id* `done`, adds its `xp` (+ `gems`), and returns a new `Track`.
- **Non-linear.** You can complete a node far ahead; the ones between stay `locked`/incomplete. There is no forced sequence.
- **Derived display.** `normalize()` re-derives the display each time: the first not-done non-chest node becomes `current` (where the mascot sits); the rest are `locked`. Only `done` is authoritative — `current`/`locked` are recomputed, never trusted from input.
- **Triggers:** the **Complete** button inside a node's detail modal (`NodeSheet`) fires `onComplete(node.id)`. The dock **Complete** is a shortcut that completes the current node.

`trackProgress(track)` returns `{ done, total, currentId }` for the dock's `N/total done` + XP bar.

---

## 5. Chests

Lifecycle: **locked → ready → opened**, all derived from the done-set (no extra stored state beyond `status: done` once opened).

| State | Condition | Look |
|---|---|---|
| **locked** | preceding node not done | closed chest, grayed/dimmed |
| **ready** | the node immediately before it is `done`, chest not opened | closed chest, full color, glowing, **rattling** (tries to open, can't) |
| **opened** | chest `status === "done"` | **open** chest art, static |

- Readiness: `readyChestIds(track)` — a chest is ready iff `flat[i-1].status === "done"` and the chest isn't done. Computed in `RoadmapView` and `Dashboard`.
- **Only opens on click.** `Dashboard.handleSelect` routes a ready chest to `openChestFlow`; locked/opened chests ignore clicks.
- Opening: `openChest(track, id)` marks it `done`, and `pickCollectable` draws a reward. The reveal modal (`CollectableModal`) shows it and **requires Done** (no dismiss), so a reward is never lost.
- Art: `Node.tsx` renders `<img>` of `CHEST_CLOSED`/`CHEST_OPEN` (pixel art, `image-rendering: pixelated`). A node's `icon` overrides both.

---

## 6. Collectables

- **Pool** lives on `Track.collectables` — authored by the teacher/backend, unlimited size.
- **No duplicates.** `pickCollectable(pool, collectedIds)` filters out already-collected ids and picks a random remaining one. When the pool is exhausted the reveal says "All collectables found!" and awards nothing.
- **Collection flow:** ready chest click → `openChest` (chest → done) → `pickCollectable` → `CollectableModal` (reveal + **Done**) → on Done the id is added to `collectedIds` → it drops into the **tray** (bottom-left shelf) with a pop-in animation. That shelf is the "designated place."
- **Images.** `icon` accepts emoji, an image URL, or an **uploaded file**. In the editor's Collectables tab, **+ Image** reads the file with `FileReader` and stores it as a `data:` URL in `icon`. `Glyph` (`icons.tsx`) renders emoji/name/URL/`data:` uniformly.
- **State:** `collectedIds` is client state in `Dashboard` today (see §9 to persist).

---

## 7. Animations

| Animation | Where | Trigger / detail |
|---|---|---|
| **Achievement pop** | `Achievement.tsx` + `.module.css` | On complete (and the dock "Run animation"). Center-screen badge springs up (`pop`), expanding light **ring**, gold **flash**, ~22 confetti **sparks**, and a **random headline** from `PRAISES`. Badge image is the completed node's `icon` (variable). ~1.7s. |
| **Chest rattle + glow** | `Node.module.css` `@keyframes chestRattle` | Ready chests only. Expands (scale 1.08) and periodically rattles; gold drop-shadow glow. |
| **Chest open swap** | `Node.tsx` | Closed→open art when the chest becomes `done`. |
| **Collectable reveal** | `CollectableModal.module.css` | Rotating conic **burst** behind the item, item **bob**, card `pop`. |
| **Tray drop-in** | `Dashboard.module.css` `@keyframes slotIn` | New collectable pops into its slot. |
| **Mascot hop** | `RoadmapView.module.css` `.mascot` | `transition: left/top 0.55s` — the pixel-cat glides to the new `current` node after a completion. Plus a continuous float. |
| **Node states** | `Node.module.css` | Current node glows/twinkles + floating START bubble; press = physical push (coin depth). |
| **Spine progress** | `RoadmapView.tsx` | Done segments use the gradient stroke; locked segments are dashed/dim. |

**Reduced motion:** every one of the above collapses under `@media (prefers-reduced-motion: reduce)`.

---

## 8. Teacher editor (`UnitEditor.tsx`)

Opened from the dock **Edit** button; a full-screen overlay. Everything it saves flows back into `data` (`onSave`) so the viewer adapts live — add/move/rename anything and the path re-renders.

**Units tab**
- Add / edit / delete units; drag to reorder units and assignments (incl. across units).
- **Add Assignment** — modal with: Type (`assignment/log/chest/project/test`, so **tests are edited here too**), Title, **Description**, **Link (optional)**, **Custom Icon**, XP, Status, Crown.
- **Add Chest** — appends a chest with no naming step.
- **Random Chests** — scatters 1–3 chests at random positions in the unit.

**Collectables tab**
- Add / edit / delete collectables; set the icon as emoji/URL, or **+ Image** to upload a file (stored as a `data:` URL).

---

## 9. Wiring to the real backend

The viewer is intentionally a thin frontend. Today `sample-data.ts` stands in for the API and progress is client-only (resets on reload). To go live:

1. **Load state.** Replace `sampleRoadmap` in `viewer/page.tsx` with a fetch/adapter over `GET /api/v1/world/[learnerId]` mapped into `RoadmapData`. Components don't care where the data comes from.
2. **Complete = server event.** In `Dashboard.handleComplete`, instead of only local `completeNode`, POST the completion for `node.id` to your backend. The authoritative done-state should come back from the rule engine (`packages/engine/evaluate.ts`) — the client `completeNode` is the optimistic mirror. Per the architecture constraint, **only the engine mutates learner state**.
3. **Persist rewards.** Store `collectedIds` and opened-chest status server-side so they survive reloads and can't be re-rolled. `pickCollectable` should ultimately run where the collected-set is authoritative (or be validated server-side) to guarantee no duplicates.
4. **Privacy.** Keep the boundary rules from `CLAUDE.md`: no names/emails/raw ids/grades in `meta` or anywhere; learner ids arrive pre-hashed.

---

## 10. Extension points

- **New node type** → add one entry to `NODE_STYLE` (`node-styles.ts`) and, if it needs a glyph, one to `PATHS` (`icons.tsx`). Layout/rendering pick it up automatically.
- **Swap chest art** → replace `public/chest-closed.png` / `public/chest-open.png` (or set a node `icon`).
- **Background photo** → drop `public/roadmap-bg.jpg` (gradient fallback shows until then).
- **Path shape / size** → tune `DEFAULTS` and the sine multiplier in `layout.ts`; node sizes in `NODE_STYLE`.
- **Celebration copy/art** → `PRAISES` in `Achievement.tsx`; pass a different `icon`.
- **Collectables** → append to `Track.collectables` (backend) or via the editor; unlimited.

---

## 11. File map

| File | Responsibility |
|---|---|
| `Dashboard.tsx` | State owner: completion, chest flow, collectables, celebrations, dock, editor overlay. |
| `RoadmapView.tsx` | Renders the board: spine, banners, nodes, mascot. |
| `Node.tsx` / `Node.module.css` | One node: coin/boss/chest visuals, states, labels. |
| `node-styles.ts` | Per-type visual + copy config (`NODE_STYLE`). |
| `layout.ts` | Pure geometry (`computeLayout`, `findCurrent`). |
| `progress.ts` | Pure engine: complete/open/normalize/ready/pick. |
| `NodeSheet.tsx` | Assignment detail modal + Complete + open-link. |
| `Achievement.tsx` | Center-screen celebration pop. |
| `CollectableModal.tsx` | Chest reveal + Done. |
| `UnitEditor.tsx` | Teacher CRUD for units/assignments/tests/chests/collectables. |
| `icons.tsx` | `Icon` set + `Glyph` (name/emoji/URL/data-URL resolver). |
| `types.ts` | The data model (backend variables). |
| `sample-data.ts` | Demo `RoadmapData` (replace with API). |
| `public/chest-*.png` | Pixel chest art. |
