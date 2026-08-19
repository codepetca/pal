import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

/**
 * Badge art is rendered by the widget into a fixed *circular* slot with
 * `object-fit: contain`, so the browser frames each badge by its canvas, not by
 * the artwork inside it. Any badge whose artwork is off-centre in its own
 * canvas, or that occupies a different share of it, renders visibly misaligned
 * or mis-sized next to its neighbours in the achievement trail.
 *
 * Because the slot is a circle, what has to fill it is the artwork's enclosing
 * circle rather than its bounding box. Sizing by the box leaves every disc
 * ringed by slot background; sizing the box to the whole canvas would instead
 * push the corners of the non-circular badges past the slot and clip them.
 * Pinning the enclosing circle covers both: a disc meets the slot edge exactly,
 * and a shape with protrusions touches it at its extremes with nothing cut off.
 *
 * These tests pin the framing contract every badge PNG must satisfy so new art
 * cannot reintroduce that drift.
 */

// Resolved from this file rather than the process cwd, so the suite runs the
// same way however it is invoked - `pnpm test`, turbo, or node pointed straight
// at this one file from anywhere in the repo.
const BADGE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "assets",
  "badges",
);

/** Canonical badge canvas: square, and the same for every badge. */
const CANVAS = 512;
/** The artwork's enclosing circle must fill the canvas, matching the slot. */
const TARGET_RADIUS = CANVAS / 2;
/** Rounding slack, in canvas pixels, for the artwork's centre point. */
const CENTRE_TOLERANCE_PX = 1;
/**
 * Slack, in canvas pixels, for the radius target. Slightly looser than
 * centring: resampling spreads the artwork's outer edge by a fraction of a
 * pixel either way, so the measured radius lands just above or below the mark.
 */
const RADIUS_TOLERANCE_PX = 2;
/** Alpha above which a pixel counts as artwork rather than empty margin. */
const ALPHA_THRESHOLD = 8;

type DecodedAlpha = {
  width: number;
  height: number;
  alpha: Uint8Array;
};

/**
 * Minimal PNG reader: enough to recover the alpha channel of a non-interlaced
 * 8-bit image. Kept local to the test so verifying art needs no image
 * dependency in the app.
 */
function decodePngAlpha(buffer: Buffer): DecodedAlpha {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  assert.equal(bitDepth, 8, "badge art must be 8 bits per channel");
  assert.equal(interlace, 0, "badge art must not be interlaced");
  assert.equal(colorType, 6, "badge art must be RGBA (colour type 6)");

  const channels = 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  // Each scanline is one filter byte plus its pixels. Check up front: a short
  // stream would otherwise unfilter into NaN and store as transparent black,
  // surfacing later as a confusing framing failure rather than a corrupt file.
  assert.equal(
    raw.length,
    height * (stride + 1),
    "badge art has a truncated or corrupt pixel stream",
  );
  const pixels = Buffer.alloc(height * stride);

  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read];
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = prior ? prior[i] : 0;
      const upLeft = prior && i >= channels ? prior[i - channels] : 0;
      let value = line[i];
      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += up;
      } else if (filter === 3) {
        value += (left + up) >> 1;
      } else if (filter === 4) {
        const predictor = left + up - upLeft;
        const dLeft = Math.abs(predictor - left);
        const dUp = Math.abs(predictor - up);
        const dUpLeft = Math.abs(predictor - upLeft);
        value +=
          dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      row[i] = value & 0xff;
    }
  }

  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    alpha[i] = pixels[i * channels + 3];
  }
  return { width, height, alpha };
}

/** Bounding box of the visible artwork within the canvas. */
function artworkBounds({ width, height, alpha }: DecodedAlpha) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  assert.ok(maxX >= 0, "badge art must contain visible pixels");
  return { minX, minY, maxX, maxY };
}

/**
 * Distance from the centre of the canvas to the furthest visible pixel - the
 * radius of the circle the artwork occupies, which is what the circular slot
 * has to accommodate.
 */
function enclosingRadius({ width, height, alpha }: DecodedAlpha) {
  const centreX = (width - 1) / 2;
  const centreY = (height - 1) / 2;
  let radius = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] <= ALPHA_THRESHOLD) continue;
      const distance = Math.hypot(x - centreX, y - centreY);
      if (distance > radius) radius = distance;
    }
  }
  assert.ok(radius > 0, "badge art must contain visible pixels");
  return radius;
}

/**
 * Connected runs of visible pixels, largest first. Eight-connected, so a shape
 * joined only at a diagonal still counts as one piece.
 */
function connectedComponents({ width, height, alpha }: DecodedAlpha) {
  const seen = new Uint8Array(width * height);
  const components: {
    size: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }[] = [];

  for (let start = 0; start < width * height; start++) {
    if (seen[start] || alpha[start] <= ALPHA_THRESHOLD) continue;
    const stack = [start];
    seen[start] = 1;
    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (stack.length) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index / width) | 0;
      size += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || alpha[next] <= ALPHA_THRESHOLD) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    components.push({ size, minX, minY, maxX, maxY });
  }

  return components.sort((a, b) => b.size - a.size);
}

const badgeFiles = readdirSync(BADGE_DIR)
  .filter((name) => name.endsWith(".png"))
  .sort();

test("there is badge art to check", () => {
  assert.ok(badgeFiles.length > 0, `no badge PNGs found in ${BADGE_DIR}`);
});

for (const file of badgeFiles) {
  test(`${file} is framed on the canonical badge canvas`, () => {
    const image = decodePngAlpha(readFileSync(join(BADGE_DIR, file)));
    assert.equal(image.width, CANVAS, `${file} canvas width`);
    assert.equal(image.height, CANVAS, `${file} canvas height`);
  });

  test(`${file} artwork is centred in its canvas`, () => {
    const image = decodePngAlpha(readFileSync(join(BADGE_DIR, file)));
    const bounds = artworkBounds(image);
    const offsetX = (bounds.minX + bounds.maxX) / 2 - (image.width - 1) / 2;
    const offsetY = (bounds.minY + bounds.maxY) / 2 - (image.height - 1) / 2;
    assert.ok(
      Math.abs(offsetX) <= CENTRE_TOLERANCE_PX,
      `${file} artwork is ${offsetX.toFixed(1)}px off centre horizontally`,
    );
    assert.ok(
      Math.abs(offsetY) <= CENTRE_TOLERANCE_PX,
      `${file} artwork is ${offsetY.toFixed(1)}px off centre vertically`,
    );
  });

  test(`${file} has no artwork detached from its body`, () => {
    const image = decodePngAlpha(readFileSync(join(BADGE_DIR, file)));
    const [body, ...rest] = connectedComponents(image);
    const detached = rest.filter(
      (component) =>
        component.maxX < body.minX ||
        component.minX > body.maxX ||
        component.maxY < body.minY ||
        component.minY > body.maxY,
    );
    assert.deepEqual(
      detached.map(
        (c) => `${c.maxX - c.minX + 1}x${c.maxY - c.minY + 1} at ${c.minX},${c.minY}`,
      ),
      [],
      `${file} has artwork sitting outside its body, which drags the bounding box out and shrinks the badge`,
    );
  });

  test(`${file} artwork fills the circular slot`, () => {
    const image = decodePngAlpha(readFileSync(join(BADGE_DIR, file)));
    const radius = enclosingRadius(image);
    assert.ok(
      Math.abs(radius - TARGET_RADIUS) <= RADIUS_TOLERANCE_PX,
      `${file} artwork reaches ${radius.toFixed(1)}px from centre, expected ` +
        `${TARGET_RADIUS}px (±${RADIUS_TOLERANCE_PX}). Short of it leaves a ring of ` +
        `slot background around the badge; past it, the slot clips the artwork.`,
    );
  });
}
