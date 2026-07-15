"use client";

import { useLoader, useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import { buildCharacter, configureSkinTexture } from "@/lib/viewer/skin";
import { pose } from "@/lib/viewer/animation";
import type { AnimName } from "@/lib/viewer/types";

const BOB_PX = 1.2; // vertical bob amplitude in skin units
const JUMP_PX = 6; // jump lift in skin units
const JUMP_PERIOD = 0.9; // seconds for one looping jump (probe/idle use)

export interface MinecraftCharacterProps {
  /** Skin filename under /viewer/skins (e.g. "player.png"). */
  skin: string;
  /** Which gait to play. Defaults to idle. */
  anim?: AnimName;
  /**
   * A ref holding the current gait, read every frame. Lets a parent (e.g. the
   * traversal controller) change the animation without triggering re-renders.
   * Takes precedence over the `anim` prop when provided.
   */
  animRef?: RefObject<AnimName>;
  overlay?: boolean;
  scale?: number;
  /** Phase offset (seconds) so identical characters don't march in lockstep. */
  phase?: number;
}

/**
 * A boxel Minecraft character wearing `skin`, animated procedurally. The mesh
 * is built once per skin; each frame we rotate the limb pivots from the pure
 * pose functions. Feet stay planted at the group origin.
 */
export function MinecraftCharacter({
  skin,
  anim = "idle",
  animRef,
  overlay = true,
  scale = 0.1,
  phase = 0,
}: MinecraftCharacterProps) {
  const texture = useLoader(THREE.TextureLoader, `/viewer/skins/${skin}`);

  const built = useMemo(() => {
    configureSkinTexture(texture);
    return buildCharacter(texture, { overlay });
  }, [texture, overlay]);

  const propAnimRef = useRef(anim);
  propAnimRef.current = anim;

  useFrame((state) => {
    const t = state.clock.elapsedTime + phase;
    const a = animRef?.current ?? propAnimRef.current;
    const jumpP = a === "jump" ? (t % JUMP_PERIOD) / JUMP_PERIOD : 0;
    const p = pose(a, t, jumpP);
    const { joints, root } = built;

    joints.legL.rotation.x = p.leftLeg;
    joints.legR.rotation.x = p.rightLeg;
    joints.armL.rotation.x = p.leftArm;
    joints.armR.rotation.x = p.rightArm;
    joints.upper.rotation.x = p.torsoLean;
    joints.upper.position.y = p.bodyY * BOB_PX;
    // A subtle head counter-bob keeps the eyeline steady.
    joints.head.rotation.x = -p.torsoLean * 0.5;
    root.position.y = p.rootY * JUMP_PX;
  });

  return <primitive object={built.root} scale={scale} />;
}
