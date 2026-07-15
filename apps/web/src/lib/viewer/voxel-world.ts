// Voxel SkyBlock engine — ported from the "SkyBlock Classroom" prototype.
//
// Real Minecraft look: vanilla per-face brightness × per-vertex smooth-lighting
// AO/skylight (no dynamic lights), seeded fBm terrain, oak/cherry trees, plants,
// a gradient sky dome, drifting clouds, falling petals, and block-break bursts.
// Each student's island uses its own seed, so every island is unique and stable.
//
// Framework-agnostic three.js — a React Three Fiber wrapper hosts it and drives
// the per-frame update fns. Client-only (uses <canvas> for procedural textures).

import * as THREE from "three";

const BLOCK = "/viewer/textures/blocks/";
// Minecraft face brightness: top 1.0, z-sides 0.8, x-sides 0.6, bottom 0.5.
const SHADE = { top: 1.0, bottom: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };
const GRASS_TINT = 0x79c05a;
const OAK_LEAF_TINT = 0x59ae30;
const CHERRY_TINT = 0xf7b8d4;

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();

function pixel<T extends THREE.Texture>(tex: T): T {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function loadTex(file: string): THREE.Texture {
  if (!texCache.has(file)) texCache.set(file, pixel(texLoader.load(BLOCK + file)));
  return texCache.get(file)!;
}

function compositeGrassSide(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  const tex = pixel(new THREE.CanvasTexture(canvas));
  let loaded = 0;
  const dirt = new Image();
  const overlay = new Image();
  const tint = "#" + new THREE.Color(GRASS_TINT).getHexString();
  const draw = () => {
    if (++loaded < 2) return;
    ctx.drawImage(dirt, 0, 0);
    const oc = document.createElement("canvas");
    oc.width = oc.height = 16;
    const octx = oc.getContext("2d")!;
    octx.drawImage(overlay, 0, 0);
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = tint;
    octx.fillRect(0, 0, 16, 16);
    octx.globalCompositeOperation = "multiply";
    octx.drawImage(overlay, 0, 0);
    ctx.drawImage(oc, 0, 0);
    tex.needsUpdate = true;
  };
  dirt.onload = overlay.onload = draw;
  dirt.src = BLOCK + "dirt.png";
  overlay.src = BLOCK + "grass_block_side_overlay.png";
  return tex;
}

function compositeGrassTop(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  const tex = pixel(new THREE.CanvasTexture(canvas));
  const overlay = new Image();
  const c = new THREE.Color(GRASS_TINT);
  overlay.onload = () => {
    const oc = document.createElement("canvas");
    oc.width = oc.height = 16;
    const octx = oc.getContext("2d")!;
    octx.drawImage(overlay, 0, 0);
    const data = octx.getImageData(0, 0, 16, 16).data;
    const grays: number[] = [];
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) grays.push(data[i]);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const g = grays[(Math.random() * grays.length) | 0] / 255;
        ctx.fillStyle = `rgb(${(c.r * 255 * g) | 0},${(c.g * 255 * g) | 0},${(c.b * 255 * g) | 0})`;
        ctx.fillRect(x, y, 1, 1);
      }
    tex.needsUpdate = true;
  };
  overlay.src = BLOCK + "grass_block_side_overlay.png";
  return tex;
}

// Unlit + vertex colors: vanilla renders blocks with no dynamic lights — face
// shading (material color) × per-vertex AO/skylight (vertex color) is the whole model.
function shadedMat(
  tex: THREE.Texture,
  shade: number,
  opts: THREE.MeshBasicMaterialParameters = {},
  tint = 0xffffff
): THREE.MeshBasicMaterial {
  const c = new THREE.Color(tint).multiplyScalar(shade);
  return new THREE.MeshBasicMaterial({ map: tex, color: c, vertexColors: true, ...opts });
}

interface BlockMatSpec {
  top: THREE.Texture;
  bottom?: THREE.Texture;
  side: THREE.Texture;
  opts?: THREE.MeshBasicMaterialParameters;
  tint?: number;
  topTint?: number;
}

function blockMats({ top, bottom, side, opts = {}, tint = 0xffffff, topTint }: BlockMatSpec) {
  return [
    shadedMat(side, SHADE.east, opts, tint),
    shadedMat(side, SHADE.west, opts, tint),
    shadedMat(top, SHADE.top, opts, topTint ?? tint),
    shadedMat(bottom ?? side, SHADE.bottom, opts, tint),
    shadedMat(side, SHADE.south, opts, tint),
    shadedMat(side, SHADE.north, opts, tint),
  ];
}

export interface Textures {
  [k: string]: THREE.Texture;
}

export function loadTextures(): Textures {
  return {
    dirt: loadTex("dirt.png"),
    stone: loadTex("stone.png"),
    bedrock: loadTex("bedrock.png"),
    netherrack: loadTex("netherrack.png"),
    oakLog: loadTex("oak_log.png"),
    oakLogTop: loadTex("oak_log_top.png"),
    oakLeaves: loadTex("oak_leaves.png"),
    oakPlanks: loadTex("oak_planks.png"),
    darkOakLog: loadTex("dark_oak_log.png"),
    darkOakLogTop: loadTex("dark_oak_log_top.png"),
    grassTop: compositeGrassTop(),
    grassSide: compositeGrassSide(),
    shortGrass: loadTex("short_grass.png"),
    fern: loadTex("fern.png"),
    pinkTulip: loadTex("pink_tulip.png"),
    redTulip: loadTex("red_tulip.png"),
    allium: loadTex("allium.png"),
  };
}

const LEAF_OPTS: THREE.MeshBasicMaterialParameters = {
  transparent: true,
  alphaTest: 0.4,
  side: THREE.DoubleSide,
};

export interface BlockType {
  mats: THREE.MeshBasicMaterial[];
  particleTex: THREE.Texture;
  particleTint?: number;
}
export type BlockTypes = Record<string, BlockType>;

export const BLOCK_TYPES = (t: Textures): BlockTypes => ({
  grass: { mats: blockMats({ top: t.grassTop, side: t.grassSide, bottom: t.dirt }), particleTex: t.dirt },
  dirt: { mats: blockMats({ top: t.dirt, side: t.dirt }), particleTex: t.dirt },
  stone: { mats: blockMats({ top: t.stone, side: t.stone }), particleTex: t.stone },
  bedrock: { mats: blockMats({ top: t.bedrock, side: t.bedrock }), particleTex: t.bedrock },
  oakLog: { mats: blockMats({ top: t.oakLogTop, bottom: t.oakLogTop, side: t.oakLog }), particleTex: t.oakLog },
  oakPlanks: { mats: blockMats({ top: t.oakPlanks, side: t.oakPlanks }), particleTex: t.oakPlanks },
  darkOakLog: { mats: blockMats({ top: t.darkOakLogTop, bottom: t.darkOakLogTop, side: t.darkOakLog }), particleTex: t.darkOakLog },
  oakLeaves: { mats: blockMats({ top: t.oakLeaves, side: t.oakLeaves, opts: LEAF_OPTS, tint: OAK_LEAF_TINT }), particleTex: t.oakLeaves, particleTint: OAK_LEAF_TINT },
  cherryLeaves: { mats: blockMats({ top: t.oakLeaves, side: t.oakLeaves, opts: LEAF_OPTS, tint: CHERRY_TINT }), particleTex: t.oakLeaves, particleTint: CHERRY_TINT },
  netherrack: { mats: blockMats({ top: t.netherrack, side: t.netherrack }), particleTex: t.netherrack },
});

// ---------- classic Minecraft procedural fire (alpha FireTextureFX) ----------

const FIRE_W = 16;
const FIRE_H = 20;
let fireA = new Float32Array(FIRE_W * FIRE_H);
let fireB = new Float32Array(FIRE_W * FIRE_H);
let fireCanvas: HTMLCanvasElement | null = null;
let fireCtx: CanvasRenderingContext2D | null = null;
let fireImageData: ImageData | null = null;
let fireTextureRef: THREE.CanvasTexture | null = null;

function fireTexture(): THREE.CanvasTexture {
  if (!fireTextureRef) {
    fireCanvas = document.createElement("canvas");
    fireCanvas.width = 16;
    fireCanvas.height = 16;
    fireCtx = fireCanvas.getContext("2d")!;
    fireImageData = fireCtx.createImageData(16, 16);
    fireTextureRef = pixel(new THREE.CanvasTexture(fireCanvas));
  }
  return fireTextureRef;
}

function stepFire() {
  for (let x = 0; x < FIRE_W; x++) {
    for (let y = 0; y < FIRE_H; y++) {
      let weight = 18;
      let acc = fireA[x + ((y + 1) % FIRE_H) * FIRE_W] * weight;
      for (let x1 = x - 1; x1 <= x + 1; x1++) {
        for (let y1 = y; y1 <= y + 1; y1++) {
          if (x1 >= 0 && y1 >= 0 && x1 < FIRE_W && y1 < FIRE_H) acc += fireA[x1 + y1 * FIRE_W];
          weight++;
        }
      }
      fireB[x + y * FIRE_W] = acc / (weight * 1.06);
      if (y >= FIRE_H - 1) {
        fireB[x + y * FIRE_W] = Math.random() * Math.random() * Math.random() * 4 + Math.random() * 0.1 + 0.2;
      }
    }
  }
  [fireA, fireB] = [fireB, fireA];

  const d = fireImageData!.data;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = fireA[x + y * FIRE_W] * 1.8;
      if (f > 1) f = 1;
      const i = (x + y * 16) * 4;
      d[i] = f * 155 + 100;
      d[i + 1] = f * f * 255;
      d[i + 2] = f * f * f * f * 128;
      d[i + 3] = f < 0.5 ? 0 : 255;
    }
  }
  fireCtx!.putImageData(fireImageData!, 0, 0);
  fireTexture().needsUpdate = true;
}

let fireAccum = 0;
export function updateFire(dt: number) {
  if (!fireTextureRef) return; // no fire in the scene yet
  fireAccum += dt;
  while (fireAccum >= 1 / 20) {
    fireAccum -= 1 / 20;
    stepFire();
  }
}

let fireMatRef: THREE.MeshBasicMaterial | null = null;
function fireMat(): THREE.MeshBasicMaterial {
  if (!fireMatRef) {
    fireMatRef = new THREE.MeshBasicMaterial({
      map: fireTexture(),
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
      fog: false,
    });
  }
  return fireMatRef;
}
const firePlane = new THREE.PlaneGeometry(1, 1);

function makeFireBlock(): THREE.Group {
  const g = new THREE.Group();
  const mat = fireMat();
  for (const ry of [Math.PI / 4, -Math.PI / 4]) {
    const p = new THREE.Mesh(firePlane, mat);
    p.rotation.y = ry;
    p.position.y = 0.5;
    g.add(p);
  }
  for (const [dx, dz, ry] of [[0.45, 0, Math.PI / 2], [-0.45, 0, Math.PI / 2], [0, 0.45, 0], [0, -0.45, 0]]) {
    const p = new THREE.Mesh(firePlane, mat);
    p.position.set(dx, 0.5, dz);
    p.rotation.y = ry;
    p.rotateOnAxis(new THREE.Vector3(1, 0, 0), (dx + dz > 0 ? -1 : 1) * 0.28);
    g.add(p);
  }
  return g;
}

// ---------- sounds ----------

const sounds: Record<string, string> = {
  explode: "/viewer/sounds/explode1.ogg",
  pop: "/viewer/sounds/pop.ogg",
  dig: "/viewer/sounds/dig_grass.ogg",
};
export function playSound(name: string, volume = 0.6) {
  try {
    const a = new Audio(sounds[name]);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {}
}

// ---------- effects ----------

type Effect = (dt: number) => boolean;
const effects: Effect[] = [];
export function updateEffects(dt: number) {
  for (let i = effects.length - 1; i >= 0; i--) if (!effects[i](dt)) effects.splice(i, 1);
}

let cameraQuatRef = new THREE.Quaternion();
export function setCameraQuat(q: THREE.Quaternion) {
  cameraQuatRef = q;
}

const particleGeo = new THREE.PlaneGeometry(1, 1);
export function blockBreakBurst(
  scene: THREE.Scene,
  pos: THREE.Vector3,
  tex: THREE.Texture,
  n = 20,
  tint = 0xffffff
) {
  for (let k = 0; k < n; k++) {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(0.25, 0.25);
    t.offset.set(Math.floor(Math.random() * 4) / 4, Math.floor(Math.random() * 4) / 4);
    const mat = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, color: tint, alphaTest: 0.1 });
    const p = new THREE.Mesh(particleGeo, mat);
    const size = 0.09 + Math.random() * 0.09;
    p.scale.setScalar(size);
    p.position.set(pos.x + (Math.random() - 0.5) * 0.8, pos.y + (Math.random() - 0.5) * 0.8, pos.z + (Math.random() - 0.5) * 0.8);
    scene.add(p);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 2, 0.6 + Math.random() * 2.6, (Math.random() - 0.5) * 2)
      .normalize()
      .multiplyScalar(2.2 + Math.random() * 2.8);
    const maxLife = 0.45 + Math.random() * 0.4;
    let life = maxLife;
    effects.push((dt) => {
      life -= dt;
      vel.y -= 16 * dt;
      p.position.addScaledVector(vel, dt);
      p.scale.setScalar(size * Math.max(0.2, life / maxLife + 0.2));
      p.quaternion.copy(cameraQuatRef);
      if (life <= 0) { scene.remove(p); mat.dispose(); t.dispose(); return false; }
      return true;
    });
  }
}

function puff(scene: THREE.Scene, pos: THREE.Vector3, vel: THREE.Vector3, color: number, size: number, life: number) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide });
  const p = new THREE.Mesh(particleGeo, mat);
  p.scale.setScalar(size);
  p.position.copy(pos);
  scene.add(p);
  let age = 0;
  effects.push((dt) => {
    age += dt;
    p.position.addScaledVector(vel, dt);
    const k = age / life;
    mat.opacity = 1 - k;
    p.scale.setScalar(size * (1 + k));
    p.quaternion.copy(cameraQuatRef);
    if (age >= life) { scene.remove(p); mat.dispose(); return false; }
    return true;
  });
}

function flameParticle(scene: THREE.Scene, pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number) {
  const p = new THREE.Mesh(particleGeo, fireMat());
  p.scale.setScalar(size);
  p.position.copy(pos);
  scene.add(p);
  let age = 0;
  effects.push((dt) => {
    age += dt;
    p.position.addScaledVector(vel, dt);
    p.scale.setScalar(size * Math.max(0.1, 1 - age / life));
    p.quaternion.copy(cameraQuatRef);
    if (age >= life) { scene.remove(p); return false; }
    return true;
  });
}

const EXPLOSION_COLORS = [0xffffff, 0xdddddd, 0x999999, 0x555555];
export function explosionBurst(scene: THREE.Scene, pos: THREE.Vector3) {
  for (let i = 0; i < 24; i++) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    puff(scene, pos.clone().addScaledVector(dir, Math.random() * 0.5), dir.multiplyScalar(1.5 + Math.random() * 2.5),
      EXPLOSION_COLORS[(Math.random() * EXPLOSION_COLORS.length) | 0], 0.3 + Math.random() * 0.45, 0.5 + Math.random() * 0.5);
  }
  for (let i = 0; i < 14; i++) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
    flameParticle(scene, pos.clone(), dir.multiplyScalar(1.5 + Math.random() * 3), 0.3 + Math.random() * 0.35, 0.35 + Math.random() * 0.3);
  }
}

export function petalEmitter(scene: THREE.Scene, canopyCenters: THREE.Vector3[]) {
  effects.push((dt) => {
    if (Math.random() < dt * 6 && canopyCenters.length) {
      const c = canopyCenters[(Math.random() * canopyCenters.length) | 0];
      const pos = new THREE.Vector3(c.x + (Math.random() - 0.5) * 3, c.y - 0.5, c.z + (Math.random() - 0.5) * 3);
      const mat = new THREE.MeshBasicMaterial({ color: 0xf3a7c8, transparent: true, side: THREE.DoubleSide });
      const p = new THREE.Mesh(particleGeo, mat);
      p.scale.setScalar(0.07);
      p.position.copy(pos);
      scene.add(p);
      let age = 0;
      const life = 2.5 + Math.random() * 1.5;
      const drift = (Math.random() - 0.5) * 0.3;
      effects.push((dt2) => {
        age += dt2;
        p.position.y -= dt2 * 0.55;
        p.position.x += Math.sin(age * 3) * dt2 * 0.4 + drift * dt2;
        p.quaternion.copy(cameraQuatRef);
        mat.opacity = Math.min(1, life - age);
        if (age >= life) { scene.remove(p); mat.dispose(); return false; }
        return true;
      });
    }
    return true;
  });
}

// ---------- island ----------

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const crossGeo = new THREE.PlaneGeometry(0.85, 0.85);

function makePlant(tex: THREE.Texture, tint = 0xffffff): THREE.Group {
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tint, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const a = new THREE.Mesh(crossGeo, mat);
  const b = new THREE.Mesh(crossGeo, mat);
  a.rotation.y = Math.PI / 4;
  b.rotation.y = -Math.PI / 4;
  g.add(a, b);
  return g;
}

// ---------- seeded noise ----------

/** Stable numeric seed from a string id, so each student's island is unique. */
export function seedFromId(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function hash2(x: number, z: number, seed: number): number {
  let h = (seed ^ (x * 374761393) ^ (z * 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smoothstep = (t: number) => t * t * (3 - 2 * t);
function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const u = smoothstep(x - xi), v = smoothstep(z - zi);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, seed: number): number {
  return valueNoise(x, z, seed) * 0.6 +
    valueNoise(x * 2.13 + 31.4, z * 2.13 - 17.7, seed ^ 0x9e3779b9) * 0.25 +
    valueNoise(x * 4.31 - 8.1, z * 4.31 + 44.2, seed ^ 0x85ebca6b) * 0.15;
}

export interface BlockRec {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  typeName: string;
}

type Step =
  | { kind: "ground"; x: number; z: number }
  | { kind: "tree"; x: number; z: number; cherry: boolean; h: number };

export interface Island {
  group: THREE.Group;
  blocks: Map<string, BlockRec>;
  key: (x: number, y: number, z: number) => string;
  removeBlock: (k: string) => BlockRec | null;
  types: BlockTypes;
  canopyCenters: THREE.Vector3[];
  nextLandSteps: (count: number) => Step[];
  runStep: (step: Step) => BlockRec[];
  runStepAnimated: (step: Step) => BlockRec[];
  /** Generate all land out to `targetRing` (instant, no relight). */
  generateRings: (targetRing: number) => void;
  /** World Y of the grass surface at the island centre (character stands here). */
  spawnTopY: number;
}

export function buildIsland(
  scene: THREE.Scene,
  types: BlockTypes,
  textures: Textures,
  seed: number
): Island {
  const group = new THREE.Group();
  scene.add(group);
  const blocks = new Map<string, BlockRec>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const canopyCenters: THREE.Vector3[] = [];

  const isLand = (x: number, z: number) => {
    const n = fbm(x / 8, z / 8, seed);
    const bias = Math.max(0, 1 - Math.hypot(x, z) / 4.5) * 0.45;
    return n + bias > 0.58;
  };
  const topYAt = (x: number, z: number) =>
    Math.max(-1, Math.min(2, Math.round((fbm(x / 6, z / 6, seed ^ 0x1234abcd) - 0.5) * 4)));
  const treeRoll = (x: number, z: number) => hash2(x, z, seed ^ 0x777);

  const plantDefs = [
    () => makePlant(textures.shortGrass, GRASS_TINT),
    () => makePlant(textures.shortGrass, GRASS_TINT),
    () => makePlant(textures.fern, GRASS_TINT),
    () => makePlant(textures.pinkTulip),
    () => makePlant(textures.redTulip),
    () => makePlant(textures.allium),
  ];

  function setBlock(x: number, y: number, z: number, typeName: string, { plantChance = 0 } = {}): BlockRec | null {
    if (blocks.has(key(x, y, z))) return null;
    const type = types[typeName];
    const geo = unitBox.clone();
    geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
    const mesh = new THREE.Mesh(geo, type.mats);
    mesh.position.set(x, y, z);
    if (plantChance && Math.random() < plantChance) {
      const plant = plantDefs[(Math.random() * plantDefs.length) | 0]();
      plant.position.y = 0.93;
      mesh.add(plant);
    }
    group.add(mesh);
    const rec: BlockRec = { mesh, x, y, z, typeName };
    blocks.set(key(x, y, z), rec);
    return rec;
  }

  function removeBlock(k: string): BlockRec | null {
    const b = blocks.get(k);
    if (!b) return null;
    group.remove(b.mesh);
    b.mesh.geometry.dispose();
    blocks.delete(k);
    return b;
  }

  function groundColumn(x: number, z: number, plantChance = 0.3): BlockRec[] {
    const placed: BlockRec[] = [];
    const push = (r: BlockRec | null) => { if (r) placed.push(r); };
    const topY = topYAt(x, z);
    let landNeighbors = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        if ((dx || dz) && isLand(x + dx, z + dz)) landNeighbors++;
    push(setBlock(x, topY, z, "grass", { plantChance }));
    const depth = Math.max(1, Math.round(1 + landNeighbors * 0.55 + hash2(x, z, seed ^ 0xdeadbeef) * 1.6));
    for (let y = topY - 1; y >= topY - depth; y--) push(setBlock(x, y, z, y <= topY - 4 ? "stone" : "dirt"));
    if (depth >= 6) push(setBlock(x, topY - depth - 1, z, "bedrock"));
    return placed;
  }

  function cherryTree(bx: number, bz: number, h: number, baseY = 0): BlockRec[] {
    const placed: BlockRec[] = [];
    const push = (r: BlockRec | null) => { if (r) placed.push(r); };
    for (let y = baseY + 1; y <= baseY + h; y++) push(setBlock(bx, y, bz, "darkOakLog"));
    push(setBlock(bx + 1, baseY + h, bz, "darkOakLog"));
    const cx = bx + 1, cy = baseY + h + 1, cz = bz;
    canopyCenters.push(new THREE.Vector3(cx, cy, cz));
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = 0; dy <= 1; dy++) {
          const rr = Math.hypot(dx, dz) + dy * 0.8;
          if (rr <= 2.4 && !(Math.abs(dx) === 2 && Math.abs(dz) === 2 && Math.random() < 0.6))
            push(setBlock(cx + dx, cy + dy, cz + dz, "cherryLeaves"));
        }
    push(setBlock(cx, cy + 2, cz, "cherryLeaves"));
    push(setBlock(cx + 1, cy + 2, cz, "cherryLeaves"));
    push(setBlock(cx, cy + 2, cz - 1, "cherryLeaves"));
    return placed;
  }

  function oakTree(bx: number, bz: number, h: number, baseY = 0): BlockRec[] {
    const placed: BlockRec[] = [];
    const push = (r: BlockRec | null) => { if (r) placed.push(r); };
    for (let y = baseY + 1; y <= baseY + h; y++) push(setBlock(bx, y, bz, "oakLog"));
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && Math.random() < 0.5) continue;
          if (dx === 0 && dz === 0 && dy === 0) continue;
          push(setBlock(bx + dx, baseY + h - 1 + dy, bz + dz, "oakLeaves"));
        }
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]])
      push(setBlock(bx + dx, baseY + h + 1, bz + dz, "oakLeaves"));
    push(setBlock(bx, baseY + h + 2, bz, "oakLeaves"));
    return placed;
  }

  // infinite generation: square rings outward from spawn, chunk-style
  let ringR = 0, ringIdx = 0, ringCells: Array<[number, number]> = [[0, 0]];
  function ringOf(r: number): Array<[number, number]> {
    if (r === 0) return [[0, 0]];
    const cells: Array<[number, number]> = [];
    for (let x = -r; x <= r; x++) { cells.push([x, -r]); cells.push([x, r]); }
    for (let z = -r + 1; z <= r - 1; z++) { cells.push([-r, z]); cells.push([r, z]); }
    cells.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
    return cells;
  }
  // ponytail: linear ring scan; fine for a demo, chunk-batch it if worlds get huge
  function nextLandSteps(count: number): Step[] {
    const steps: Step[] = [];
    while (steps.length < count) {
      if (ringIdx >= ringCells.length) { ringR++; ringIdx = 0; ringCells = ringOf(ringR); }
      const [x, z] = ringCells[ringIdx++];
      if (!isLand(x, z)) continue;
      steps.push({ kind: "ground", x, z });
      const roll = treeRoll(x, z);
      if (roll < 0.045) {
        let clear = true;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (treeRoll(x + dx, z + dz) < roll) clear = false;
        if (clear) steps.push({ kind: "tree", x, z, cherry: hash2(x, z, seed ^ 0xf00d) < 0.6, h: 3 + ((hash2(x, z, seed ^ 0xbeef) * 2) | 0) });
      }
    }
    return steps;
  }

  function runStep(step: Step): BlockRec[] {
    if (step.kind === "ground") return groundColumn(step.x, step.z, 0.3);
    const baseY = topYAt(step.x, step.z);
    return step.cherry ? cherryTree(step.x, step.z, step.h, baseY) : oakTree(step.x, step.z, step.h, baseY);
  }

  function runStepAnimated(step: Step): BlockRec[] {
    const placed = step.kind === "ground"
      ? groundColumn(step.x, step.z, 0.35)
      : step.cherry
        ? cherryTree(step.x, step.z, step.h, topYAt(step.x, step.z))
        : oakTree(step.x, step.z, step.h, topYAt(step.x, step.z));
    for (const rec of placed) animatePop(rec.mesh);
    return placed;
  }

  function generateRings(targetRing: number) {
    while (ringR <= targetRing) {
      const steps = nextLandSteps(1);
      for (const s of steps) runStep(s);
      if (blocks.size > 8000) break; // safety cap
    }
  }

  const island: Island = {
    group, blocks, key, removeBlock, types, canopyCenters,
    nextLandSteps, runStep, runStepAnimated, generateRings,
    spawnTopY: topYAt(0, 0) + 0.5,
  };
  return island;
}

// ---------- smooth lighting (per-vertex AO + skylight) ----------

const AO_LEVELS = [1.0, 0.8, 0.64, 0.5];

function skyFactor(island: Island, x: number, y: number, z: number): number {
  for (let yy = y + 1; yy <= y + 12; yy++) if (island.blocks.has(island.key(x, yy, z))) return 0.72;
  return 1.0;
}

export function relight(island: Island) {
  const has = (x: number, y: number, z: number) => island.blocks.has(island.key(x, y, z));
  for (const b of island.blocks.values()) {
    const geo = b.mesh.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const col = geo.attributes.color;
    const sky = skyFactor(island, b.x, b.y, b.z);
    for (let i = 0; i < pos.count; i++) {
      const n = [nor.getX(i), nor.getY(i), nor.getZ(i)];
      const a = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
      const t1 = (a + 1) % 3, t2 = (a + 2) % 3;
      const s = [Math.sign(pos.getX(i)), Math.sign(pos.getY(i)), Math.sign(pos.getZ(i))];
      const base = [b.x, b.y, b.z];
      const off = (axes: number[]) => {
        const p = [...base];
        p[a] += n[a];
        for (const ax of axes) p[ax] += s[ax];
        return has(p[0], p[1], p[2]);
      };
      const side1 = off([t1]), side2 = off([t2]);
      const corner = off([t1, t2]);
      const occ = side1 && side2 ? 3 : (side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0);
      const c = AO_LEVELS[occ] * sky;
      col.setXYZ(i, c, c, c);
    }
    col.needsUpdate = true;
  }
}

function animatePop(mesh: THREE.Mesh) {
  mesh.scale.setScalar(0.01);
  let t = 0;
  const dur = 0.32;
  effects.push((dt) => {
    t += dt;
    const k = Math.min(t / dur, 1);
    const s = k < 0.7 ? (k / 0.7) * 1.12 : 1.12 - 0.12 * ((k - 0.7) / 0.3);
    mesh.scale.setScalar(Math.max(s, 0.01));
    if (k >= 1) { mesh.scale.setScalar(1); return false; }
    return true;
  });
}

/** Event: grow the island outward (a completed assignment). Animated + sfx. */
export function expandIsland(scene: THREE.Scene, island: Island, count = 4) {
  const steps = island.nextLandSteps(count);
  steps.forEach((step, i) => {
    setTimeout(() => {
      const placed = island.runStepAnimated(step);
      if (placed.length) {
        playSound("pop", 0.7);
        const p = placed[0];
        blockBreakBurst(scene, new THREE.Vector3(p.x, p.y + 0.6, p.z), island.types.dirt.particleTex, 6);
        relight(island);
      }
    }, i * 200);
  });
}

/** Event: netherrack asteroid → explosion → crater + lingering vanilla fire. */
export function launchAsteroid(
  scene: THREE.Scene,
  island: Island,
  targetKey: string,
  onDone?: () => void
) {
  const target = island.blocks.get(targetKey);
  if (!target) { onDone?.(); return; }
  const targetPos = new THREE.Vector3(target.x, target.y, target.z);

  const rock = new THREE.Group();
  const nMat = island.types.netherrack.mats;
  rock.add(new THREE.Mesh(unitBox, nMat));
  for (const [dx, dy, dz] of [[0.5, 0.4, 0.1], [-0.45, -0.3, 0.35], [0.1, -0.5, -0.4]]) {
    const m = new THREE.Mesh(unitBox, nMat);
    m.scale.setScalar(0.55);
    m.position.set(dx, dy, dz);
    rock.add(m);
  }
  rock.scale.setScalar(0.8);
  const start = targetPos.clone().add(new THREE.Vector3(10 + Math.random() * 4, 16, -(6 + Math.random() * 4)));
  rock.position.copy(start);
  scene.add(rock);

  const dur = 1.0;
  let t = 0;
  effects.push((dt) => {
    t += dt;
    const k = Math.min(t / dur, 1);
    rock.position.lerpVectors(start, targetPos, k * k);
    rock.rotation.x += dt * 7;
    rock.rotation.z += dt * 5;
    flameParticle(scene, rock.position.clone(),
      new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.6, (Math.random() - 0.5) * 0.5), 0.3 + Math.random() * 0.2, 0.35);
    if (Math.random() < 0.5)
      puff(scene, rock.position.clone(), new THREE.Vector3(0, 0.4, 0), 0x555555, 0.22, 0.5);
    if (k >= 1) {
      scene.remove(rock);
      playSound("explode", 0.8);
      explosionBurst(scene, targetPos);
      const R = 1.6;
      const craterRim: BlockRec[] = [];
      for (const [bk, b] of [...island.blocks]) {
        const d = Math.hypot(b.x - target.x, b.y - target.y, b.z - target.z);
        if (d <= R && b.typeName !== "bedrock") {
          const type = island.types[b.typeName];
          blockBreakBurst(scene, new THREE.Vector3(b.x, b.y, b.z), type.particleTex, 10, type.particleTint ?? 0xffffff);
          island.removeBlock(bk);
        } else if (d > R && d <= R + 1.2 && b.y >= target.y - 1) {
          craterRim.push(b);
        }
      }
      relight(island);
      for (const b of craterRim) {
        if (Math.random() > 0.5) continue;
        if (island.blocks.has(island.key(b.x, b.y + 1, b.z))) continue;
        const fire = makeFireBlock();
        fire.position.set(b.x, b.y + 0.51, b.z);
        scene.add(fire);
        let age = 0;
        const burnFor = 2.5 + Math.random() * 2.5;
        effects.push((dt2) => {
          age += dt2;
          if (Math.random() < dt2 * 3)
            puff(scene, fire.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
              new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.7, (Math.random() - 0.5) * 0.2), 0x333333, 0.15, 1.2);
          if (age >= burnFor) { scene.remove(fire); return false; }
          return true;
        });
      }
      onDone?.();
      return false;
    }
    return true;
  });
}

// ---------- sky / clouds ----------

export function setupSky(scene: THREE.Scene): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "#6a8dff");
  g.addColorStop(0.5, "#7ba4ff");
  g.addColorStop(0.78, "#aec9ff");
  g.addColorStop(1, "#cfdfff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 128);
  const skyTex = new THREE.CanvasTexture(canvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(150, 16, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);
  scene.background = new THREE.Color(0xcfdfff);
  scene.fog = new THREE.Fog(0xcfdfff, 30, 110);
  return dome;
}

export interface Cloud extends THREE.Group {
  userData: { speed: number };
}

export function createClouds(scene: THREE.Scene): THREE.Group[] {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 12; i++) {
    const c = new THREE.Group();
    const n = 2 + ((Math.random() * 4) | 0);
    for (let j = 0; j < n; j++) {
      const puffM = new THREE.Mesh(new THREE.BoxGeometry(2.5 + Math.random() * 2.5, 0.35, 1.8 + Math.random()), mat);
      puffM.position.set(j * 1.8, 0, (Math.random() - 0.5) * 2);
      c.add(puffM);
    }
    // Keep clouds in the far, high sky so they never sit next to a small island
    // or between it and the camera.
    const ang = Math.random() * Math.PI * 2;
    const dist = 42 + Math.random() * 45;
    c.position.set(Math.cos(ang) * dist, 24 + Math.random() * 12, Math.sin(ang) * dist);
    c.userData.speed = 0.6 + Math.random() * 0.5;
    scene.add(c);
    clouds.push(c);
  }
  return clouds;
}

export function updateClouds(clouds: THREE.Group[], dt: number) {
  for (const c of clouds) {
    c.position.x += (c.userData as { speed: number }).speed * dt;
    if (c.position.x > 90) c.position.x = -90;
  }
}
