"use client";

// The roadmap content for one student: a winding path (completed portion lit,
// the rest dim), a station per assignment, and the character walking/running/
// jumping to exactly where the student's progress stands. Rendered as a plain
// group so it can be dropped into the expanded scene full-size or onto a mini
// island in the overview.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { MinecraftCharacter } from "./MinecraftCharacter";
import { AssignmentNode } from "./AssignmentNode";
import { layoutNodes, hashSeed } from "@/lib/viewer/path-curve";
import { progressT, nodeStatus, currentIndex } from "@/lib/viewer/progress";
import { PALETTE } from "@/lib/viewer/theme";
import type { AnimName, Course, Student } from "@/lib/viewer/types";

const PATH_RADIUS = 0.32;
const RUN_SPEED = 9; // world units / sec
const JUMP_SPEED = 5; // slower while airborne
const WALK_APPROACH_U = 0.14; // switch to a walk this far (in u) from the goal

/** Sample the curve to find the arc-length parameter u nearest each node. */
function computeNodeUs(
  curve: THREE.CatmullRomCurve3,
  points: THREE.Vector3[],
  samples = 500
): number[] {
  const sampled: THREE.Vector3[] = [];
  for (let i = 0; i <= samples; i++) sampled.push(curve.getPointAt(i / samples));
  return points.map((p) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= samples; i++) {
      const d = sampled[i].distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best / samples;
  });
}

/** Two-tone tube: vertices up to `splitU` use the "done" colour, rest "todo". */
function buildPathGeometry(
  curve: THREE.CatmullRomCurve3,
  splitU: number
): THREE.TubeGeometry {
  const tubular = 220;
  const geo = new THREE.TubeGeometry(curve, tubular, PATH_RADIUS, 10, false);
  const done = new THREE.Color(PALETTE.pathDone);
  const todo = new THREE.Color(PALETTE.pathTodo);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const ringVerts = 10 + 1; // radialSegments + 1
  for (let i = 0; i < pos.count; i++) {
    const ring = Math.floor(i / ringVerts); // 0..tubular
    const u = ring / tubular;
    const c = u <= splitU + 1e-4 ? done : todo;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

interface TravelingCharacterProps {
  curve: THREE.CatmullRomCurve3;
  targetU: number;
  milestoneUs: number[];
  skin: string;
  scale: number;
  animate: boolean;
  overlay: boolean;
}

function TravelingCharacter({
  curve,
  targetU,
  milestoneUs,
  skin,
  scale,
  animate,
  overlay,
}: TravelingCharacterProps) {
  const group = useRef<THREE.Group>(null);
  const animRef = useRef<AnimName>("idle");
  const u = useRef(animate ? 0 : targetU);
  const jumpUntil = useRef(0);
  const milestoneIdx = useRef(0);
  const length = useMemo(() => curve.getLength(), [curve]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const now = state.clock.elapsedTime;

    if (u.current < targetU - 1e-4) {
      const airborne = now < jumpUntil.current;
      const speed = airborne ? JUMP_SPEED : RUN_SPEED;
      u.current = Math.min(targetU, u.current + (speed / length) * dt);

      // Fire a jump when crossing a milestone that's within reach.
      while (
        milestoneIdx.current < milestoneUs.length &&
        u.current >= milestoneUs[milestoneIdx.current] &&
        milestoneUs[milestoneIdx.current] <= targetU + 1e-4
      ) {
        jumpUntil.current = now + 0.6;
        milestoneIdx.current++;
      }

      if (now < jumpUntil.current) animRef.current = "jump";
      else animRef.current = targetU - u.current < WALK_APPROACH_U ? "walk" : "run";
    } else {
      animRef.current = "idle";
    }

    const uu = Math.min(1, Math.max(0, u.current));
    const p = curve.getPointAt(uu);
    g.position.set(p.x, p.y, p.z);
    const tan = curve.getTangentAt(uu);
    g.rotation.y = Math.atan2(tan.x, tan.z);
  });

  return (
    <group ref={group}>
      <MinecraftCharacter
        skin={skin}
        animRef={animRef}
        scale={scale}
        overlay={overlay}
      />
    </group>
  );
}

export interface RoadmapProps {
  student: Student;
  course: Course;
  /** Character scale (smaller for island minis). */
  characterScale?: number;
  /** Play the walk-in animation. Off for static island minis. */
  animate?: boolean;
  /** Render the skin's overlay layer (off for tiny island minis). */
  characterOverlay?: boolean;
}

export function Roadmap({
  student,
  course,
  characterScale = 0.1,
  animate = true,
  characterOverlay = true,
}: RoadmapProps) {
  const total = course.assignments.length;

  // Same course id → same path shape for every student; progress differs.
  const { points, curve, nodeUs, milestoneUs } = useMemo(() => {
    const raw = layoutNodes(total, hashSeed(course.id));
    const pts = raw.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    const c = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
    c.arcLengthDivisions = 600;
    const us = computeNodeUs(c, pts);
    const mUs = course.assignments
      .map((a, i) => (a.kind === "milestone" ? us[i] : -1))
      .filter((v) => v >= 0);
    return { points: pts, curve: c, nodeUs: us, milestoneUs: mUs };
  }, [total, course]);

  const targetU = useMemo(() => {
    const idx = currentIndex(student.completedCount, total);
    return nodeUs[idx] ?? 0;
  }, [student.completedCount, total, nodeUs]);

  const pathGeo = useMemo(
    () => buildPathGeometry(curve, targetU),
    [curve, targetU]
  );

  return (
    <group>
      <mesh geometry={pathGeo}>
        <meshStandardMaterial vertexColors roughness={0.7} metalness={0} />
      </mesh>

      {course.assignments.map((a, i) => (
        <AssignmentNode
          key={a.id}
          position={{ x: points[i].x, y: points[i].y, z: points[i].z }}
          status={nodeStatus(i, student.completedCount)}
          kind={a.kind}
        />
      ))}

      <TravelingCharacter
        curve={curve}
        targetU={targetU}
        milestoneUs={milestoneUs}
        skin={student.skin}
        scale={characterScale}
        animate={animate}
        overlay={characterOverlay}
      />
    </group>
  );
}
