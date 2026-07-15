"use client";

// SkyBlock Classroom: each student's progress is a floating voxel island that
// grows as they complete assignments. Pick a student to visit their island;
// complete an assignment to grow it, or miss one to call down an asteroid.

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

import { VoxelWorld, type IslandActions } from "./VoxelWorld";
import { CameraFrame } from "./CameraFrame";
import { seedFromId } from "@/lib/viewer/voxel-world";
import { demoClass } from "@/lib/viewer/demo-data";
import { percentComplete, progressFraction } from "@/lib/viewer/progress";
import styles from "../viewer.module.css";

const total = demoClass.course.assignments.length;
// Progress → island size (rings of terrain). Bounded so islands stay performant.
const ringsFor = (completed: number) =>
  2 + Math.round(progressFraction(completed, total) * 4);

export default function ViewerApp() {
  const [selectedId, setSelectedId] = useState(demoClass.students[0].id);
  const student = useMemo(
    () => demoClass.students.find((s) => s.id === selectedId)!,
    [selectedId]
  );
  // Live count grows as you complete assignments (island grows via expand()).
  const [liveCompleted, setLiveCompleted] = useState(student.completedCount);
  const actionsRef = useRef<IslandActions | null>(null);

  useEffect(() => {
    setLiveCompleted(student.completedCount);
  }, [student]);

  const seed = useMemo(() => seedFromId(student.id), [student]);
  // Island is built from the student's baseline; completing grows it live.
  const rings = useMemo(() => ringsFor(student.completedCount), [student]);
  const [radius, setRadius] = useState(6);
  const pct = percentComplete(liveCompleted, total);

  const complete = () => {
    if (liveCompleted >= total) return;
    setLiveCompleted((c) => c + 1);
    actionsRef.current?.expand(4);
  };
  const miss = () => actionsRef.current?.asteroid();

  return (
    <div className={styles.root}>
      <div className={styles.canvasWrap}>
        <Canvas
          camera={{ position: [16, 12, 16], fov: 55 }}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          dpr={[1, 2]}
        >
          {/* Blocks are unlit (vanilla) and ignore these; the lights are for the
              character, which uses a lit material. */}
          <ambientLight intensity={0.95} />
          <directionalLight position={[12, 22, 8]} intensity={1.25} />

          <VoxelWorld
            key={student.id}
            seed={seed}
            rings={rings}
            skin={student.skin}
            actionsRef={actionsRef}
            onRadius={setRadius}
          />
          <CameraFrame radius={radius} />
          <OrbitControls
            key={student.id}
            target={[0, 1, 0]}
            enableDamping
            dampingFactor={0.08}
            minDistance={6}
            maxDistance={90}
            maxPolarAngle={Math.PI - 0.25}
          />
        </Canvas>
      </div>

      <div className={styles.vignette} />

      {/* title */}
      <div className={styles.title}>
        <div className={styles.titleMain}>
          <span className={styles.pick}>⛏</span> {demoClass.course.title}
        </div>
        <div className={styles.titleSub}>each island grows as its student progresses</div>
      </div>

      {/* roster */}
      <div className={styles.roster}>
        {demoClass.students.map((s) => {
          const p = percentComplete(
            s.id === selectedId ? liveCompleted : s.completedCount,
            total
          );
          return (
            <button
              key={s.id}
              className={`${styles.rosterItem} ${
                s.id === selectedId ? styles.rosterActive : ""
              }`}
              onClick={() => setSelectedId(s.id)}
            >
              <span className={styles.rosterHandle}>{s.handle}</span>
              <span className={styles.rosterPct}>{p}%</span>
            </button>
          );
        })}
      </div>

      {/* selected student panel */}
      <div className={styles.infoPanel}>
        <div className={styles.infoHandle}>{student.handle}</div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.infoRow}>
          {liveCompleted} / {total} assignments · {pct}%
        </div>
        <div className={styles.actions}>
          <button className={styles.grow} onClick={complete} disabled={liveCompleted >= total}>
            ✓ Complete assignment
          </button>
          <button className={styles.strike} onClick={miss}>
            ☄ Miss deadline
          </button>
        </div>
      </div>
    </div>
  );
}
