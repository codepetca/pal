"use client";

// Drives the camera cinematically. Because the Canvas persists while the scene
// content swaps, simply changing `mode` makes the camera ease from the overview
// pose to the roadmap pose — that easing IS the fly-in (and fly-out on back).
// A slow sway keeps both views alive.

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export type CameraMode = "overview" | "expanded";

interface Pose {
  pos: [number, number, number];
  look: [number, number, number];
  sway: number;
}

const POSES: Record<CameraMode, Pose> = {
  overview: { pos: [0, 8, 30], look: [0, 0, -6], sway: 0.12 },
  expanded: { pos: [0, 12, 23], look: [0, 1.5, 0], sway: 0.18 },
};

export function CameraRig({ mode }: { mode: CameraMode }) {
  const { camera } = useThree();
  const swayT = useRef(0);
  const currentLook = useRef(new THREE.Vector3(0, 0, -6));
  const tmp = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    const pose = POSES[mode];
    const look = tmp.current.set(...pose.look);

    // Gentle horizontal sway around the look point.
    swayT.current += dt * 0.15;
    const off = new THREE.Vector3(
      pose.pos[0] - pose.look[0],
      0,
      pose.pos[2] - pose.look[2]
    );
    const r = Math.hypot(off.x, off.z);
    const baseAngle = Math.atan2(off.x, off.z);
    const a = baseAngle + Math.sin(swayT.current) * pose.sway;
    const desired = new THREE.Vector3(
      pose.look[0] + Math.sin(a) * r,
      pose.pos[1],
      pose.look[2] + Math.cos(a) * r
    );

    // Frame-rate independent easing (~1.3s fly between modes).
    const alpha = 1 - Math.pow(0.05, dt);
    camera.position.lerp(desired, alpha);
    currentLook.current.lerp(look, alpha);
    camera.lookAt(currentLook.current);
  });

  return null;
}
