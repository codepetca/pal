"use client";

import {
  type CSSProperties,
  forwardRef,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import { usePalWidget } from "./provider";
import type { PalCompanionMood, PalCompanionProps, PalMotion } from "./types";


// The two frames of a mood alternate at this interval. Deliberately slow for a
// sprite animation: each pose has to register as its own drawing rather than
// blending into the next.
const MOOD_FRAME_MS = 600;

// Sleeping runs on its own clock. The two frames are one breath in and one
// breath out, so the pace has to read as a resting animal rather than as an
// animation — a settled cat breathes roughly twenty times a minute, which puts
// half a breath here.
const MOOD_FRAME_MS_OVERRIDES: Partial<Record<PalCompanionMood, number>> = {
  sleeping: 1500,
};

// A blink plays blinking-1..5 in sequence, then rests. The art is authored as a
// ping-pong — frame 5 is byte-identical to frame 1 and frame 4 to frame 2, with
// frame 3 the closed-eye peak — and frame 1 matches the resting pose, so the
// sequence enters and leaves it without a visible cut.
const BLINK_FRAME_MS = 70;
const BLINK_EVERY_MS = 4000;

// The source PNGs are tightly cropped to their visible alpha bounds. The rest
// pose is the scale reference; other frames keep their authored size relative
// to it and use measured offsets so independently cropped poses do not jump.
const REST_H = 1676;
const REST_W = 1720;

// `dx` and `dy` register each frame against the resting pose, in that frame's
// own cropped pixels, applied on top of centring the art and sitting it on the
// box floor. The poses have different tight dimensions and the cat is
// not placed identically on any two of them, so the obvious geometry — centre
// each crop, flush the bottom — lands the cat in a different spot on almost
// every frame, which reads as a twitch on each frame change.
//
// Deriving these for new art: sample both alpha masks, reduce each to a row and
// a column occupancy profile, and cross-correlate those against the resting
// pose's. The shifts that maximise the two correlations are `dy` and `dx`, in
// canvas pixels; positive `dy` moves the frame down. Registering on the mask
// rather than on the bounding box matters — a pose with a limb extended pushes
// its bounding-box centre sideways while the body has not moved, so aligning
// boxes would introduce exactly the drift this is meant to remove.
//
// Frame heights are scaled against REST_H, keeping the authored proportions
// and these offsets valid at any rendered size.
type Frame = { src: string; w: number; h: number; dx: number; dy: number };

type FrameSpec = { file: string; w: number; h: number; dx: number; dy: number };

const BLINK_SPECS: FrameSpec[] = [1, 2, 3, 4, 5].map((n) => ({
  file: `blinking-${n}`,
  w: REST_W,
  h: REST_H,
  dx: 0,
  dy: 0,
}));

// Moods with animation frames. A mood absent here — "neutral" — falls back to
// the resting pose and blinks.
//
// The second frame of each mood carries its own offsets rather than sharing the
// first's: the art moves the cat between the two, and only a per-frame value can
// hold the body still through the loop.
const MOOD_SPECS: Partial<Record<PalCompanionMood, FrameSpec[]>> = {
  happy: [
    { file: "happy-1", w: 1836, h: 1676, dx: -58, dy: 0 },
    { file: "happy-2", w: 1932, h: 1606, dx: 6, dy: -64 },
  ],
  excited: [
    { file: "excited-1", w: 1727, h: 1676, dx: 2.5, dy: 4 },
    { file: "excited-2", w: 1835, h: 1805, dx: 0.5, dy: -24 },
  ],
  // Both sleeping frames are cropped to one shared box rather than to their own
  // alpha bounds, so the breathing loop cannot drift: the offsets that hold the
  // pair against the resting pose are identical, and the only movement left is
  // the one the art draws.
  sleeping: [
    { file: "sleeping-1", w: 1473, h: 1459, dx: 0, dy: 0 },
    { file: "sleeping-2", w: 1473, h: 1459, dx: 0, dy: 0 },
  ],
};

type SpriteSet = {
  rest: Frame;
  blink: Frame[];
  byMood: Partial<Record<PalCompanionMood, Frame[]>>;
};

function siblingAssetUrl(restUrl: string, file: string): string {
  return `${restUrl.slice(0, restUrl.lastIndexOf("/") + 1)}${file}`;
}

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
  const toFrame = (spec: FrameSpec): Frame => ({
    src: siblingAssetUrl(restUrl, `${spec.file}.png`),
    w: spec.w,
    h: spec.h,
    dx: spec.dx,
    dy: spec.dy,
  });

  // The resting pose is the registration reference, so its offsets are zero by
  // definition, and it is the one frame addressed by the snapshot's own URL.
  const rest: Frame = { src: restUrl, w: REST_W, h: REST_H, dx: 0, dy: 0 };
  const blink: Frame[] = BLINK_SPECS.map(toFrame);

  const byMood: Partial<Record<PalCompanionMood, Frame[]>> = {};
  for (const [mood, specs] of Object.entries(MOOD_SPECS)) {
    byMood[mood as PalCompanionMood] = specs.map(toFrame);
  }

  return { rest, blink, byMood };
}

function findVisibleSpriteImg(root: HTMLElement): HTMLImageElement | null {
  const frames = root.querySelectorAll<HTMLImageElement>("img.pal-companion-sprite");
  for (const frame of frames) {
    if (window.getComputedStyle(frame).opacity === "1") return frame;
  }
  return null;
}

/**
 * Keeps transparent cat pixels from becoming a surprising host drag target.
 * The pet owns this knowledge so hosts never query Pal's private sprite DOM.
 * The drawn cat is now the only interaction target the box contains.
 */
function isTransparentAt(
  img: HTMLImageElement,
  clientX: number,
  clientY: number,
): boolean {
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return false;

  const rect = img.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return false;

  const x = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(relX * img.naturalWidth)));
  const y = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(relY * img.naturalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  try {
    context.drawImage(img, 0, 0);
    return context.getImageData(x, y, 1, 1).data[3] === 0;
  } catch {
    return false;
  }
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
  const [failedFrames, setFailedFrames] = useState<Set<string>>(() => new Set());
  const [loadedFrames, setLoadedFrames] = useState<Set<string>>(() => new Set());

  // The two-frame mood loop. Restarting at frame 0 on every mood change means a
  // new mood always opens on its first pose.
  const frameMs = MOOD_FRAME_MS_OVERRIDES[mood] ?? MOOD_FRAME_MS;
  useEffect(() => {
    setMoodFrame(0);
    if (still || !frames) return;
    const id = setInterval(
      () => setMoodFrame((f) => (f + 1) % frames.length),
      frameMs,
    );
    return () => clearInterval(id);
  }, [frameMs, frames, still]);

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

  const requestedSrc = frames
    ? frames[moodFrame].src
    : blinkFrame >= 0
      ? sprites.blink[blinkFrame].src
      : sprites.rest.src;
  const activeSrc =
    requestedSrc === sprites.rest.src ||
    (loadedFrames.has(requestedSrc) && !failedFrames.has(requestedSrc))
      ? requestedSrc
      : sprites.rest.src;

  // Only mount frames this mood can actually show. The rest pose remains
  // visible while those images load, so a first visit does not need to fetch
  // every mood up front just to avoid an empty box during the first animation.
  const animatedFrames = frames
    ? still
      ? [frames[0]]
      : frames
    : still
      ? []
      : sprites.blink;
  const mountedFrames = [sprites.rest, ...animatedFrames];

  return (
    <>
      {mountedFrames.map((frame) => (
        <img
          key={frame.src}
          className="pal-companion-sprite"
          crossOrigin="anonymous"
          src={frame.src}
          alt=""
          width={frame.w}
          height={frame.h}
          onLoad={() => {
            if (frame.src !== sprites.rest.src) {
              setLoadedFrames((current) => {
                if (current.has(frame.src)) return current;
                return new Set(current).add(frame.src);
              });
            }
          }}
          onError={() => {
            if (frame.src !== sprites.rest.src) {
              setFailedFrames((current) => {
                if (current.has(frame.src)) return current;
                return new Set(current).add(frame.src);
              });
            }
          }}
          style={{
            opacity: frame.src === activeSrc ? 1 : 0,
            height: `${((frame.h / REST_H) * 100).toFixed(3)}%`,
            // Offsets are percentages of this tightly cropped frame. This keeps
            // every pose registered while avoiding transparent layout padding.
            transform: `translate(calc(-50% + ${((frame.dx / frame.w) * 100).toFixed(3)}%), ${((frame.dy / frame.h) * 100).toFixed(3)}%)`,
          }}
        />
      ))}
    </>
  );
}

export const PalCompanion = forwardRef<HTMLElement, PalCompanionProps>(
function PalCompanion(
  {
    scale = 1,
    className,
    style,
    onPointerDown,
    ...hostProps
  },
  ref,
) {
  const { density, motion, snapshot, state, theme, viewport } = usePalWidget();
  if (state === "error" || !snapshot) return null;

  const companion = snapshot.companion;
  const progression = snapshot.progression;
  // Pal's canonical projection owns story eligibility. The widget renders that
  // display decision instead of rebuilding entitlement from duplicate fields.
  const companionReveal = progression?.companionReveal;
  const companionUnlocked = companionReveal
    ? companionReveal.status === "earned"
    : true;
  const companionAssetUrl = companionReveal
    ? companionReveal.assetUrl
    : companion.assetUrl;
  const companionScale = Number.isFinite(scale)
    ? Math.min(1.2, Math.max(0.4, scale))
    : 1;
  const companionStyle = {
    ...style,
    "--pal-companion-cat-height": `${companionScale * 10}rem`,
  } as CSSProperties;
  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const activeFrame = findVisibleSpriteImg(event.currentTarget);
    if (activeFrame && isTransparentAt(activeFrame, event.clientX, event.clientY)) {
      return;
    }
    onPointerDown?.(event);
  };
  const label = companionUnlocked
    ? `${companion.name}, your Pal companion. ${companion.moodLabel}. ${companion.message} Level ${companion.level}; ${companion.streak} school-day rhythm.`
    : companionReveal?.status === "locked"
      ? companionReveal.label
      : "Mystery companion.";

  return (
    <aside
      {...hostProps}
      ref={ref}
      className={["pal-companion", className].filter(Boolean).join(" ")}
      style={companionStyle}
      onPointerDown={handlePointerDown}
      data-pal-density={density}
      data-pal-motion={motion}
      data-pal-theme={theme}
      data-pal-viewport={viewport}
      data-pal-mood={companion.mood}
      data-pal-companion-unlocked={companionUnlocked ? "true" : "false"}
      aria-label={label}
    >
      <div className="pal-companion-stage" aria-hidden="true">
        {!companionUnlocked ? (
          companionAssetUrl ? (
            <div className="pal-companion-art">
              <img
                className="pal-companion-sprite pal-companion-static"
                crossOrigin="anonymous"
                src={companionAssetUrl}
                alt=""
                width="512"
                height="512"
              />
            </div>
          ) : null
        ) : companionAssetUrl ? (
          <div className="pal-companion-art">
            <PetSprite
              key={companionAssetUrl}
              mood={companion.mood}
              motion={motion}
              restUrl={companionAssetUrl}
            />
          </div>
        ) : (
          <div className="pal-companion-art">
            <span>🐾</span>
          </div>
        )}
      </div>
    </aside>
  );
});
