// Builds a boxel Minecraft character from a 64x64 skin, the same body the
// LibGDX game draws, reconstructed for three.js.
//
// Each cuboid part is assembled from six textured planes — one per face — so
// the UV mapping is explicit and correct per face rather than relying on
// BoxGeometry's face/vertex ordering. Pixel rectangles below follow the modern
// 1.8+ 64x64 skin layout.

import * as THREE from "three";

export type PartName = "head" | "body" | "armR" | "armL" | "legR" | "legL";
type FaceName = "front" | "back" | "right" | "left" | "top" | "bottom";
/** [x, y, w, h] in skin pixels, measured from the top-left of the image. */
type Rect = [number, number, number, number];
type FaceRects = Record<FaceName, Rect>;

interface PartSpec {
  dims: { w: number; h: number; d: number };
  base: FaceRects;
  overlay: FaceRects;
}

const TEX = 64;

export const MC_LAYOUT: Record<PartName, PartSpec> = {
  head: {
    dims: { w: 8, h: 8, d: 8 },
    base: {
      front: [8, 8, 8, 8], back: [24, 8, 8, 8], right: [0, 8, 8, 8],
      left: [16, 8, 8, 8], top: [8, 0, 8, 8], bottom: [16, 0, 8, 8],
    },
    overlay: {
      front: [40, 8, 8, 8], back: [56, 8, 8, 8], right: [32, 8, 8, 8],
      left: [48, 8, 8, 8], top: [40, 0, 8, 8], bottom: [48, 0, 8, 8],
    },
  },
  body: {
    dims: { w: 8, h: 12, d: 4 },
    base: {
      front: [20, 20, 8, 12], back: [32, 20, 8, 12], right: [16, 20, 4, 12],
      left: [28, 20, 4, 12], top: [20, 16, 8, 4], bottom: [28, 16, 8, 4],
    },
    overlay: {
      front: [20, 36, 8, 12], back: [32, 36, 8, 12], right: [16, 36, 4, 12],
      left: [28, 36, 4, 12], top: [20, 32, 8, 4], bottom: [28, 32, 8, 4],
    },
  },
  armR: {
    dims: { w: 4, h: 12, d: 4 },
    base: {
      front: [44, 20, 4, 12], back: [52, 20, 4, 12], right: [40, 20, 4, 12],
      left: [48, 20, 4, 12], top: [44, 16, 4, 4], bottom: [48, 16, 4, 4],
    },
    overlay: {
      front: [44, 36, 4, 12], back: [52, 36, 4, 12], right: [40, 36, 4, 12],
      left: [48, 36, 4, 12], top: [44, 32, 4, 4], bottom: [48, 32, 4, 4],
    },
  },
  armL: {
    dims: { w: 4, h: 12, d: 4 },
    base: {
      front: [36, 52, 4, 12], back: [44, 52, 4, 12], right: [32, 52, 4, 12],
      left: [40, 52, 4, 12], top: [36, 48, 4, 4], bottom: [40, 48, 4, 4],
    },
    overlay: {
      front: [52, 52, 4, 12], back: [60, 52, 4, 12], right: [48, 52, 4, 12],
      left: [56, 52, 4, 12], top: [52, 48, 4, 4], bottom: [56, 48, 4, 4],
    },
  },
  legR: {
    dims: { w: 4, h: 12, d: 4 },
    base: {
      front: [4, 20, 4, 12], back: [12, 20, 4, 12], right: [0, 20, 4, 12],
      left: [8, 20, 4, 12], top: [4, 16, 4, 4], bottom: [8, 16, 4, 4],
    },
    overlay: {
      front: [4, 36, 4, 12], back: [12, 36, 4, 12], right: [0, 36, 4, 12],
      left: [8, 36, 4, 12], top: [4, 32, 4, 4], bottom: [8, 32, 4, 4],
    },
  },
  legL: {
    dims: { w: 4, h: 12, d: 4 },
    base: {
      front: [20, 52, 4, 12], back: [28, 52, 4, 12], right: [16, 52, 4, 12],
      left: [24, 52, 4, 12], top: [20, 48, 4, 4], bottom: [24, 48, 4, 4],
    },
    overlay: {
      front: [4, 52, 4, 12], back: [12, 52, 4, 12], right: [0, 52, 4, 12],
      left: [8, 52, 4, 12], top: [4, 48, 4, 4], bottom: [8, 48, 4, 4],
    },
  },
};

/** Sets a plane's UVs to a skin sub-rectangle (image origin is top-left). */
function applyUV(geo: THREE.PlaneGeometry, [x, y, w, h]: Rect): void {
  const u0 = x / TEX;
  const u1 = (x + w) / TEX;
  const v0 = 1 - y / TEX; // top edge
  const v1 = 1 - (y + h) / TEX; // bottom edge
  const uv = geo.attributes.uv;
  uv.setXY(0, u0, v0); // top-left
  uv.setXY(1, u1, v0); // top-right
  uv.setXY(2, u0, v1); // bottom-left
  uv.setXY(3, u1, v1); // bottom-right
  uv.needsUpdate = true;
}

/** One textured face plane placed on the surface of a (w,h,d) box at origin. */
function makeFace(
  face: FaceName,
  dims: { w: number; h: number; d: number },
  rect: Rect,
  material: THREE.Material
): THREE.Mesh {
  const { w, h, d } = dims;
  let geo: THREE.PlaneGeometry;
  const mesh = () => new THREE.Mesh(geo, material);

  switch (face) {
    case "front": {
      geo = new THREE.PlaneGeometry(w, h);
      applyUV(geo, rect);
      const m = mesh();
      m.position.set(0, 0, d / 2);
      return m;
    }
    case "back": {
      geo = new THREE.PlaneGeometry(w, h);
      applyUV(geo, rect);
      const m = mesh();
      m.position.set(0, 0, -d / 2);
      m.rotation.y = Math.PI;
      return m;
    }
    case "right": {
      geo = new THREE.PlaneGeometry(d, h);
      applyUV(geo, rect);
      const m = mesh();
      m.position.set(w / 2, 0, 0);
      m.rotation.y = Math.PI / 2;
      return m;
    }
    case "left": {
      geo = new THREE.PlaneGeometry(d, h);
      applyUV(geo, rect);
      const m = mesh();
      m.position.set(-w / 2, 0, 0);
      m.rotation.y = -Math.PI / 2;
      return m;
    }
    case "top": {
      geo = new THREE.PlaneGeometry(w, d);
      applyUV(geo, rect);
      const m = mesh();
      m.position.set(0, h / 2, 0);
      m.rotation.x = -Math.PI / 2;
      return m;
    }
    case "bottom": {
      geo = new THREE.PlaneGeometry(w, d);
      applyUV(geo, rect);
      const m = mesh();
      m.position.set(0, -h / 2, 0);
      m.rotation.x = Math.PI / 2;
      return m;
    }
  }
}

/** Assemble the six faces of one part (optionally with its overlay layer). */
function buildPart(
  spec: PartSpec,
  baseMat: THREE.Material,
  overlayMat: THREE.Material | null
): THREE.Group {
  const g = new THREE.Group();
  const faces: FaceName[] = ["front", "back", "right", "left", "top", "bottom"];
  for (const f of faces) g.add(makeFace(f, spec.dims, spec.base[f], baseMat));

  if (overlayMat) {
    // Overlay sits a hair outside the base to avoid z-fighting.
    const outer = 1.06;
    const og = new THREE.Group();
    og.scale.setScalar(outer);
    const od = {
      w: spec.dims.w,
      h: spec.dims.h,
      d: spec.dims.d,
    };
    for (const f of faces) og.add(makeFace(f, od, spec.overlay[f], overlayMat));
    g.add(og);
  }
  return g;
}

/** Configure a loaded skin texture for crisp, unfiltered pixels. */
export function configureSkinTexture(tex: THREE.Texture): THREE.Texture {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface CharacterJoints {
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** Upper body (torso + head + arms) — bobbed vertically during gaits. */
  upper: THREE.Group;
}

export interface BuiltCharacter {
  /** Feet rest at y=0; total height ~32 skin-units before scaling. */
  root: THREE.Group;
  joints: CharacterJoints;
}

/**
 * Build the full character. Limbs live in pivot groups placed at their joints
 * (shoulders, hips, neck) so the animation layer can rotate them naturally.
 * Units are skin pixels; scale the returned root to taste.
 */
export function buildCharacter(
  texture: THREE.Texture,
  opts: { overlay?: boolean } = {}
): BuiltCharacter {
  const overlay = opts.overlay ?? true;
  const baseMat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.85,
    metalness: 0,
  });
  const overlayMat = overlay
    ? new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.5,
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      })
    : null;

  const root = new THREE.Group();

  // Legs pivot at the hips (y=12) and hang down.
  const legR = new THREE.Group();
  legR.position.set(-2, 12, 0);
  const legRMesh = buildPart(MC_LAYOUT.legR, baseMat, overlayMat);
  legRMesh.position.y = -6;
  legR.add(legRMesh);

  const legL = new THREE.Group();
  legL.position.set(2, 12, 0);
  const legLMesh = buildPart(MC_LAYOUT.legL, baseMat, overlayMat);
  legLMesh.position.y = -6;
  legL.add(legLMesh);

  // Upper body bobs as one unit; feet stay planted.
  const upper = new THREE.Group();

  const torso = buildPart(MC_LAYOUT.body, baseMat, overlayMat);
  torso.position.y = 18; // hips(12) + half body height(6)
  upper.add(torso);

  const head = new THREE.Group();
  head.position.set(0, 24, 0); // top of torso
  const headMesh = buildPart(MC_LAYOUT.head, baseMat, overlayMat);
  headMesh.position.y = 4; // half head height
  head.add(headMesh);
  upper.add(head);

  const armR = new THREE.Group();
  armR.position.set(-6, 23, 0); // shoulder
  const armRMesh = buildPart(MC_LAYOUT.armR, baseMat, overlayMat);
  armRMesh.position.y = -5;
  armR.add(armRMesh);
  upper.add(armR);

  const armL = new THREE.Group();
  armL.position.set(6, 23, 0);
  const armLMesh = buildPart(MC_LAYOUT.armL, baseMat, overlayMat);
  armLMesh.position.y = -5;
  armL.add(armLMesh);
  upper.add(armL);

  root.add(legR, legL, upper);

  return { root, joints: { head, armL, armR, legL, legR, upper } };
}
