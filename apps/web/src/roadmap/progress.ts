import type { Collectable, RoadmapNode, Track, Unit } from "./types";

/**
 * Progression engine for the viewer. Pure functions over a Track — no React,
 * no DOM. Completion is per-node and NON-linear: the backend (here, a button)
 * sends "complete <id>" for a specific assignment. Nodes in between stay
 * incomplete. Chests are opened by clicking, not completed.
 *
 * Stored status is just `done` vs not. `current` (mascot position) and chest
 * readiness are derived, so the display always follows the done-set.
 */

/** All nodes in visual (unit) order — the progression sequence. */
export function flatNodes(track: Track): RoadmapNode[] {
  return track.units.flatMap((u) => u.nodes);
}

export function trackProgress(track: Track): { done: number; total: number; currentId: string | null } {
  const flat = flatNodes(track);
  const done = flat.filter((n) => n.status === "done").length;
  const current = flat.find((n) => n.status !== "done" && n.type !== "chest");
  return { done, total: flat.length, currentId: current?.id ?? null };
}

/** Chests whose immediately-preceding node is done — i.e. openable now. */
export function readyChestIds(track: Track): Set<string> {
  const flat = flatNodes(track);
  const ids = new Set<string>();
  for (let i = 0; i < flat.length; i++) {
    const n = flat[i];
    if (n.type === "chest" && n.status !== "done" && flat[i - 1]?.status === "done") {
      ids.add(n.id);
    }
  }
  return ids;
}

/** Immutably set one node's status; returns rebuilt units. */
function withStatus(track: Track, id: string, status: RoadmapNode["status"]): Unit[] {
  return track.units.map((u) => ({
    ...u,
    nodes: u.nodes.map((n) => (n.id === id ? { ...n, status } : n)),
  }));
}

/**
 * Re-derive display statuses from the done-set: the first not-done, non-chest
 * node becomes `current` (mascot sits there), every other not-done non-chest
 * is `locked`, chests stay `done` (opened) or `locked` (readiness is derived).
 */
function normalize(track: Track): Track {
  let currentAssigned = false;
  const units = track.units.map((u) => ({
    ...u,
    nodes: u.nodes.map((n) => {
      if (n.status === "done") return n;
      if (n.type === "chest") return n.status === "locked" ? n : { ...n, status: "locked" as const };
      if (!currentAssigned) {
        currentAssigned = true;
        return { ...n, status: "current" as const };
      }
      return { ...n, status: "locked" as const };
    }),
  }));
  return { ...track, units };
}

/**
 * Complete a specific assignment (the only path to done — the backend decides).
 * Marks it done, awards its XP + a few gems, re-derives statuses. No-op for
 * chests or already-done nodes. Returns the new track and the completed node.
 */
export function completeNode(track: Track, id: string): { track: Track; node: RoadmapNode | null } {
  const target = flatNodes(track).find((n) => n.id === id);
  if (!target || target.status === "done" || target.type === "chest") {
    return { track, node: null };
  }
  const units = withStatus(track, id, "done");
  const learner = {
    ...track.learner,
    xp: track.learner.xp + target.xp,
    gems: track.learner.gems + Math.max(1, Math.round(target.xp / 10)),
  };
  const next = normalize({ ...track, units, learner });

  if (process.env.NODE_ENV !== "production") {
    console.assert(
      flatNodes(next).find((n) => n.id === id)?.status === "done",
      "[progress] completeNode should mark the target done",
    );
  }
  return { track: next, node: target };
}

/** Mark a chest opened (done). Readiness/duplication is enforced by callers. */
export function openChest(track: Track, id: string): Track {
  return normalize({ ...track, units: withStatus(track, id, "done") });
}

/** Random collectable the learner hasn't got yet, or null when all are found. */
export function pickCollectable(pool: Collectable[], collected: string[]): Collectable | null {
  const avail = pool.filter((c) => !collected.includes(c.id));
  if (!avail.length) return null;
  return avail[Math.floor(Math.random() * avail.length)];
}
