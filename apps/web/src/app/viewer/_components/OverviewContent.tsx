"use client";

// Overview content: every student's roadmap as a floating island. No Canvas or
// lights of its own — it lives inside the shared Canvas in ViewerApp.

import { useMemo } from "react";

import { Island } from "./Island";
import { demoClass } from "@/lib/viewer/demo-data";
import type { Vec3 } from "@/lib/viewer/types";

function layoutIslands(count: number): Vec3[] {
  const perRow = 4;
  return Array.from({ length: count }, (_, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    return {
      x: (col - (perRow - 1) / 2) * 9 + (row % 2 ? 2.5 : -2.5),
      y: Math.sin(i * 1.3) * 1.4,
      z: row * -11 - (col % 2) * 3,
    };
  });
}

export function OverviewContent({
  onSelect,
}: {
  onSelect: (studentId: string) => void;
}) {
  const positions = useMemo(
    () => layoutIslands(demoClass.students.length),
    []
  );

  return (
    <>
      {demoClass.students.map((student, i) => (
        <Island
          key={student.id}
          student={student}
          course={demoClass.course}
          position={positions[i]}
          phase={i * 0.8}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
