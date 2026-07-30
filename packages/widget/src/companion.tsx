"use client";

import { useEffect, useMemo, useState } from "react";

import { usePalWidget } from "./provider";
import type { PalCompanionMood, PalCompanionProps, PalMotion } from "./types";

// The two frames of a mood alternate at this interval. Deliberately slow for a
// sprite animation: each pose has to register as its own drawing rather than
// blending into the next.
const MOOD_FRAME_MS = 600;

// A blink plays blinking-1..5 in sequence, then rests. The art is authored as a
// ping-pong — frame 5 is byte-identical to frame 1 and frame 4 to frame 2, with
// frame 3 the closed-eye peak — and frame 1 matches the resting pose, so the
// sequence enters and leaves it without a visible cut.
const BLINK_FRAME_MS = 70;
const BLINK_EVERY_MS = 4000;

// Every pose is drawn on a canvas of this height; only the widths differ.
const CANVAS_H = 2048;
const REST_W = 1952;

// `dx` is a horizontal nudge in the frame's own canvas pixels, applied on top of
// centring the canvas. The poses are drawn on canvases of different widths and
// the cat is not centred identically on each, so centring the canvas alone — the
// obvious thing — leaves the happy poses noticeably right of the resting one,
// which reads as a jitter every time the mood changes.
//
// Deriving these for new art: lay the frame over the resting pose with the two
// canvases centred and their bottoms flush, then find the horizontal shift that
// maximises the overlap of the two alpha masks. That shift is `dx`. Both frames
// of a pose should come out the same — they do here, which is what shows the
// offset belongs to the canvas rather than the pose; if they disagree, the two
// frames are drawn inconsistently and the art is worth fixing rather than
// compensating for in code. Vertically the canvases already agree, so
// bottom-flush needs no correction.
type Frame = { src: string; w: number; dx: number };

// Moods with animation frames. A mood absent here — "neutral", and "sleeping"
// until there is art for it — falls back to the resting pose and blinks.
const MOOD_SPRITES: Partial<
  Record<PalCompanionMood, { name: string; w: number; dx: number }>
> = {
  happy: { name: "happy", w: 2126, dx: -64 },
  excited: { name: "excited", w: 2502, dx: -16 },
};

type SpriteSet = {
  rest: Frame;
  blink: Frame[];
  byMood: Partial<Record<PalCompanionMood, Frame[]>>;
  all: Frame[];
};

/**
 * Builds the frame table from the resting pose the snapshot points at.
 *
 * The animation frames live beside that file and are named after it, so the
 * URLs are derived rather than hardcoded: an integration serving Pal's art from
 * its own origin keeps working, and the widget needs no knowledge of where
 * Pal's public directory sits. The cost is that the naming convention is
 * implicit — a snapshot whose companion art does not ship the sibling frames
 * 404s on them, and the pet holds its resting pose.
 */
function buildSprites(restUrl: string): SpriteSet {
  const base = restUrl.slice(0, restUrl.lastIndexOf("/") + 1);
  const rest: Frame = { src: restUrl, w: REST_W, dx: 0 };

  const blink: Frame[] = [1, 2, 3, 4, 5].map((n) => ({
    src: `${base}blinking-${n}.png`,
    w: REST_W,
    dx: 0,
  }));

  const byMood: Partial<Record<PalCompanionMood, Frame[]>> = {};
  for (const [mood, sprite] of Object.entries(MOOD_SPRITES)) {
    byMood[mood as PalCompanionMood] = [1, 2].map((n) => ({
      src: `${base}${sprite.name}-${n}.png`,
      w: sprite.w,
      dx: sprite.dx,
    }));
  }

  // Every frame is mounted at once and switched by opacity. Swapping the `src`
  // of a single <img> instead would fetch mid-animation and flash an empty box
  // on the first pass through each pose.
  const all = [rest, ...blink, ...Object.values(byMood).flat()];

  return { rest, blink, byMood, all };
}

/**
 * Tracks the OS-level motion preference.
 *
 * The stylesheet answers `prefers-reduced-motion` on its own, but this
 * animation is driven by timers rather than CSS, so it has to ask directly —
 * otherwise `motion="system"` would honour the preference for every other
 * surface and keep the pet moving anyway. Starts false so the server and the
 * first client render agree; the effect corrects it before any frame advances.
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/**
 * The pet, driven entirely by the mood the snapshot reports. Three cases:
 *
 *   mood has frames → alternate them forever (happy, excited)
 *   mood has none   → rest on the still pose and blink periodically (neutral)
 *   unknown mood    → treated as the resting case, so a mood the widget has no
 *                     art for degrades to a still pet rather than an empty box
 *
 * Nothing here decides *when* a mood changes — that is the rule engine's job,
 * and this component only ever reads the result.
 */
function PetSprite({
  mood,
  motion,
  restUrl,
}: {
  mood: PalCompanionMood;
  motion: PalMotion;
  restUrl: string;
}) {
  const sprites = useMemo(() => buildSprites(restUrl), [restUrl]);
  const frames = sprites.byMood[mood];

  // Reduced motion holds the mood's opening pose. The pet still changes with
  // the mood — that is information, not decoration — it just stops moving.
  const prefersReduced = usePrefersReducedMotion();
  const still = motion === "reduced" || (motion === "system" && prefersReduced);

  const [moodFrame, setMoodFrame] = useState(0);
  const [blinkFrame, setBlinkFrame] = useState(-1);

  // The two-frame mood loop. Restarting at frame 0 on every mood change means a
  // new mood always opens on its first pose.
  useEffect(() => {
    setMoodFrame(0);
    if (still || !frames) return;
    const id = setInterval(
      () => setMoodFrame((f) => (f + 1) % frames.length),
      MOOD_FRAME_MS,
    );
    return () => clearInterval(id);
  }, [frames, still]);

  // Idle blinking, and only idle — the happy and excited art has no blink
  // frames, and a pet already animating a mood does not need a second animation
  // on top.
  useEffect(() => {
    setBlinkFrame(-1);
    if (still || frames) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // One chained timeout rather than an interval per frame, so a mood change
    // mid-blink cancels the whole sequence instead of leaving strays queued.
    const step = (i: number) => {
      if (cancelled) return;
      if (i >= sprites.blink.length) {
        setBlinkFrame(-1);
        timer = setTimeout(() => step(0), BLINK_EVERY_MS);
        return;
      }
      setBlinkFrame(i);
      timer = setTimeout(() => step(i + 1), BLINK_FRAME_MS);
    };

    timer = setTimeout(() => step(0), BLINK_EVERY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [frames, sprites, still]);

  const activeSrc = frames
    ? frames[moodFrame].src
    : blinkFrame >= 0
      ? sprites.blink[blinkFrame].src
      : sprites.rest.src;

  return (
    <>
      {sprites.all.map((frame) => (
        <img
          key={frame.src}
          className="pal-companion-sprite"
          src={frame.src}
          alt=""
          width={frame.w}
          height={CANVAS_H}
          style={{
            opacity: frame.src === activeSrc ? 1 : 0,
            // Both terms are percentages of the frame's own width, so the nudge
            // stays correct at any rendered size.
            transform: `translateX(calc(-50% + ${((frame.dx / frame.w) * 100).toFixed(3)}%))`,
          }}
        />
      ))}
    </>
  );
}

export function PalCompanion({ variant = "responsive" }: PalCompanionProps) {
  const { density, motion, snapshot, state, theme, viewport } = usePalWidget();
  if (state === "error" || !snapshot) return null;

  const companion = snapshot.companion;

  return (
    <aside
      className="pal-companion"
      data-pal-density={density}
      data-pal-motion={motion}
      data-pal-theme={theme}
      data-pal-viewport={viewport}
      data-pal-mood={companion.mood}
      data-pal-variant={variant}
      aria-label={`${companion.name}, your Pal companion. ${companion.moodLabel}. ${companion.message} Level ${companion.level}; ${companion.streak} day rhythm.`}
    >
      <div className="pal-companion-art" aria-hidden="true">
        {companion.assetUrl ? (
          <PetSprite
            mood={companion.mood}
            motion={motion}
            restUrl={companion.assetUrl}
          />
        ) : (
          <span>🐾</span>
        )}
      </div>
      <div className="pal-companion-copy">
        <div className="pal-companion-title">
          <strong>{companion.name}</strong>
          <span>{companion.moodLabel}</span>
        </div>
        <p>{companion.message}</p>
        <div className="pal-companion-stats" aria-label="Companion progress">
          <span>Level {companion.level}</span>
          <span>{companion.streak} day rhythm</span>
        </div>
      </div>
    </aside>
  );
}
