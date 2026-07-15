"use client";

// A single station on the roadmap: a low pad coloured by status, with a
// floating marker for milestones and a soft ring under the current station.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { AssignmentKind, NodeStatus, Vec3 } from "@/lib/viewer/types";
import { PALETTE } from "@/lib/viewer/theme";

export interface AssignmentNodeProps {
  position: Vec3;
  status: NodeStatus;
  kind: AssignmentKind;
}

function padColor(status: NodeStatus): string {
  if (status === "done") return PALETTE.nodeDone;
  if (status === "current") return PALETTE.nodeCurrent;
  return PALETTE.nodeLocked;
}

export function AssignmentNode({ position, status, kind }: AssignmentNodeProps) {
  const marker = useRef<THREE.Mesh>(null);
  const isMilestone = kind === "milestone";
  const locked = status === "locked";

  useFrame((state) => {
    if (marker.current) {
      marker.current.rotation.y = state.clock.elapsedTime * 0.8;
      marker.current.position.y =
        2.1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.12;
    }
  });

  return (
    <group position={[position.x, position.y, position.z]}>
      {/* pad */}
      <mesh position-y={0.15}>
        <cylinderGeometry args={[1.15, 1.3, 0.3, 28]} />
        <meshStandardMaterial
          color={padColor(status)}
          roughness={0.6}
          metalness={0}
          transparent={locked}
          opacity={locked ? 0.55 : 1}
          emissive={status === "current" ? PALETTE.nodeCurrent : "#000000"}
          emissiveIntensity={status === "current" ? 0.5 : 0}
        />
      </mesh>

      {/* soft ring under the current station */}
      {status === "current" && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[1.5, 1.9, 40]} />
          <meshBasicMaterial
            color={PALETTE.nodeCurrent}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* floating gem for milestones */}
      {isMilestone && (
        <mesh ref={marker} position-y={2.1}>
          <octahedronGeometry args={[0.6]} />
          <meshStandardMaterial
            color={PALETTE.milestone}
            roughness={0.3}
            metalness={0.1}
            transparent={locked}
            opacity={locked ? 0.45 : 1}
            emissive={PALETTE.milestone}
            emissiveIntensity={locked ? 0.05 : 0.35}
          />
        </mesh>
      )}
    </group>
  );
}
