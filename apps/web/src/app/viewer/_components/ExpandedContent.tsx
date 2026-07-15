"use client";

// Expanded content: one student's full roadmap with the character walking in.
// Lives inside the shared Canvas in ViewerApp.

import { ContactShadows } from "@react-three/drei";

import { Roadmap } from "./Roadmap";
import { demoClass } from "@/lib/viewer/demo-data";
import { PALETTE } from "@/lib/viewer/theme";
import type { Student } from "@/lib/viewer/types";

export function ExpandedContent({ student }: { student: Student }) {
  return (
    <>
      {/* soft ground beneath the path */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.4}>
        <planeGeometry args={[240, 240]} />
        <meshStandardMaterial color={PALETTE.ground} roughness={1} />
      </mesh>

      {/* soft contact shadow grounds the stations + character */}
      <ContactShadows
        position={[0, -0.36, -7]}
        scale={44}
        far={7}
        blur={2.6}
        opacity={0.32}
        color="#37456a"
      />

      {/* centre the winding path on the origin */}
      <group position={[0, 0, -7]}>
        <Roadmap
          // Remount per student so the walk-in replays on each selection.
          key={student.id}
          student={student}
          course={demoClass.course}
        />
      </group>
    </>
  );
}
