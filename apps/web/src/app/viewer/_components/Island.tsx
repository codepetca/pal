"use client";

// One student's roadmap as a floating island: a landscaped disc with soil
// hanging beneath, a shrunk static roadmap on top, and a hover-lift. Clicking
// selects the student so the camera can fly in.

import { useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import { Roadmap } from "./Roadmap";
import { percentComplete } from "@/lib/viewer/progress";
import { ISLAND, PALETTE } from "@/lib/viewer/theme";
import type { Course, Student, Vec3 } from "@/lib/viewer/types";

const DISC_R = 3.6;
const MINI_SCALE = 0.26;

export interface IslandProps {
  student: Student;
  course: Course;
  position: Vec3;
  /** Phase offset so islands don't bob in unison. */
  phase: number;
  onSelect: (studentId: string) => void;
  dimmed?: boolean;
}

export function Island({
  student,
  course,
  position,
  phase,
  onSelect,
  dimmed = false,
}: IslandProps) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const pct = percentComplete(student.completedCount, course.assignments.length);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const bob = Math.sin(t * 0.5 + phase) * 0.35;
    const lift = hovered ? 1.1 : 0;
    g.position.y = position.y + bob + lift;
    const targetScale = hovered ? 1.06 : 1;
    g.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.15);
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = "pointer";
  };
  const out = () => {
    setHovered(false);
    document.body.style.cursor = "auto";
  };

  return (
    <group
      ref={group}
      position={[position.x, position.y, position.z]}
      onPointerOver={over}
      onPointerOut={out}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(student.id);
      }}
    >
      {/* grassy top */}
      <mesh position-y={-0.25}>
        <cylinderGeometry args={[DISC_R, DISC_R, 0.5, 48]} />
        <meshStandardMaterial
          color={ISLAND.top}
          roughness={0.9}
          transparent={dimmed}
          opacity={dimmed ? 0.5 : 1}
        />
      </mesh>
      {/* soil underside */}
      <mesh position-y={-1.9}>
        <coneGeometry args={[DISC_R, 3, 48]} />
        <meshStandardMaterial
          color={ISLAND.soil}
          roughness={1}
          transparent={dimmed}
          opacity={dimmed ? 0.5 : 1}
        />
      </mesh>

      {/* the mini roadmap, centered on the disc */}
      <group scale={MINI_SCALE} position={[0, 0, 0]}>
        <group position={[0, 0, -7]}>
          <Roadmap
            student={student}
            course={course}
            animate={false}
            characterOverlay={false}
          />
        </group>
      </group>

      {/* floating label */}
      <Html center position={[0, 3.4, 0]} distanceFactor={18} pointerEvents="none">
        <div
          style={{
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
            color: PALETTE.ink,
            textAlign: "center",
            whiteSpace: "nowrap",
            opacity: dimmed ? 0.5 : 1,
            transform: hovered ? "scale(1.08)" : "scale(1)",
            transition: "transform 160ms ease",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.2 }}>
            {student.handle}
          </div>
          <div style={{ fontSize: 13, color: PALETTE.inkSoft }}>{pct}%</div>
        </div>
      </Html>
    </group>
  );
}
