"use client";

// R3F host for the ported voxel engine. It builds the sky, one student's island
// (sized by progress via a seed + ring count), clouds and petals imperatively
// into the scene, drives the per-frame effect updates, and stands the Minecraft
// character on top. The parent gets an imperative handle to grow the island or
// drop an asteroid.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { MinecraftCharacter } from "./MinecraftCharacter";
import {
  loadTextures, BLOCK_TYPES, buildIsland, relight, setupSky, createClouds,
  updateClouds, updateEffects, updateFire, petalEmitter, expandIsland,
  launchAsteroid, setCameraQuat, type Island, type BlockTypes, type Textures,
} from "@/lib/viewer/voxel-world";

export interface IslandActions {
  /** Grow the island (a completed assignment). */
  expand: (count?: number) => void;
  /** Drop an asteroid on a random grass block (a missed deadline). */
  asteroid: () => void;
}

interface VoxelWorldProps {
  /** Seed → the island's shape; stable per student. */
  seed: number;
  /** How many rings of terrain to pre-generate (progress → island size). */
  rings: number;
  /** Character skin filename. */
  skin: string;
  /** Filled with imperative actions once the island is built. */
  actionsRef: RefObject<IslandActions | null>;
  /** Reports the island's horizontal radius so the camera can frame it. */
  onRadius?: (radius: number) => void;
}

export function VoxelWorld({ seed, rings, skin, actionsRef, onRadius }: VoxelWorldProps) {
  const { scene, camera } = useThree();
  const domeRef = useRef<THREE.Mesh | null>(null);
  const cloudsRef = useRef<THREE.Group[]>([]);
  const islandRef = useRef<Island | null>(null);
  const canopyRef = useRef<THREE.Vector3[]>([]);
  const worldRef = useRef<{ types: BlockTypes; textures: Textures } | null>(null);
  const [spawnTopY, setSpawnTopY] = useState(1.5);

  // One-time: sky, clouds, petals, textures.
  useEffect(() => {
    domeRef.current = setupSky(scene);
    cloudsRef.current = createClouds(scene);
    const textures = loadTextures();
    worldRef.current = { textures, types: BLOCK_TYPES(textures) };
    petalEmitter(scene, canopyRef.current);
    setCameraQuat(camera.quaternion);
    return () => {
      if (domeRef.current) scene.remove(domeRef.current);
      for (const c of cloudsRef.current) scene.remove(c);
    };
    // scene/camera are stable for the Canvas lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per student: (re)build the island.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;

    const island = buildIsland(scene, world.types, world.textures, seed);
    island.generateRings(rings);
    relight(island);
    islandRef.current = island;
    setSpawnTopY(island.spawnTopY);

    // Report the island's horizontal reach so the camera frames it snugly.
    let maxR = 3;
    for (const b of island.blocks.values()) maxR = Math.max(maxR, Math.hypot(b.x, b.z));
    onRadius?.(maxR);

    // Point the single petal emitter at this island's canopies.
    canopyRef.current.length = 0;
    canopyRef.current.push(...island.canopyCenters);

    actionsRef.current = {
      expand: (count = 4) => expandIsland(scene, island, count),
      asteroid: () => {
        const tops = [...island.blocks.entries()].filter(([, b]) => b.typeName === "grass");
        if (!tops.length) return;
        const [k] = tops[(Math.random() * tops.length) | 0];
        launchAsteroid(scene, island, k);
      },
    };

    return () => {
      scene.remove(island.group);
      for (const b of island.blocks.values()) b.mesh.geometry.dispose();
      island.blocks.clear();
      canopyRef.current.length = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, rings]);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.1);
    updateEffects(d);
    updateFire(d);
    updateClouds(cloudsRef.current, d);
    if (domeRef.current) domeRef.current.position.copy(state.camera.position);
    setCameraQuat(state.camera.quaternion);
  });

  return (
    <group position={[0, spawnTopY, 0]}>
      <MinecraftCharacter skin={skin} anim="idle" scale={0.07} />
    </group>
  );
}
