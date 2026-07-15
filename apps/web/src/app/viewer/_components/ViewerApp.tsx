"use client";

// The whole viewer: one persistent Canvas that swaps between the overview and a
// student's expanded roadmap, with the CameraRig flying between the two. A DOM
// HUD sits on top.

import { useCallback, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";

import { GradientSky } from "./GradientSky";
import { CameraRig } from "./CameraRig";
import { OverviewContent } from "./OverviewContent";
import { ExpandedContent } from "./ExpandedContent";
import { demoClass } from "@/lib/viewer/demo-data";
import { currentIndex, percentComplete } from "@/lib/viewer/progress";
import { PALETTE } from "@/lib/viewer/theme";
import styles from "../viewer.module.css";

export default function ViewerApp() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped on every transition to restart the masking flash animation.
  const [flashKey, setFlashKey] = useState(0);

  const student = useMemo(
    () => demoClass.students.find((s) => s.id === selectedId) ?? null,
    [selectedId]
  );

  const transition = useCallback((next: string | null) => {
    setFlashKey((k) => k + 1);
    // Swap content a beat into the flash so the pop is hidden.
    window.setTimeout(() => setSelectedId(next), 150);
  }, []);

  const total = demoClass.course.assignments.length;
  const pct = student
    ? percentComplete(student.completedCount, total)
    : 0;
  const currentTitle = student
    ? pct >= 100
      ? "Course complete"
      : demoClass.course.assignments[
          currentIndex(student.completedCount, total)
        ].title
    : "";

  return (
    <div className={styles.root}>
      <div className={styles.canvasWrap}>
        <Canvas
          camera={{ position: [0, 8, 30], fov: 45 }}
          // preserveDrawingBuffer lets the canvas be screenshotted (used by the
          // headless capture checks); the cost is negligible for this scene.
          gl={{ preserveDrawingBuffer: true }}
          dpr={[1, 2]}
        >
          <GradientSky top={PALETTE.skyTop} bottom={PALETTE.skyBottom} />
          {/* Fog fades distant ground/islands into the sky's horizon tone for
              atmospheric depth. The sky sphere isn't fogged (its ShaderMaterial
              ignores scene fog), so the gradient stays intact. */}
          <fog attach="fog" args={[PALETTE.skyBottom, 34, 95]} />
          <ambientLight intensity={0.85} />
          <directionalLight position={[12, 20, 14]} intensity={1.4} />
          <directionalLight position={[-10, 8, -8]} intensity={0.35} />

          <CameraRig mode={student ? "expanded" : "overview"} />

          {student ? (
            <ExpandedContent student={student} />
          ) : (
            <OverviewContent onSelect={transition} />
          )}
        </Canvas>
      </div>

      {/* subtle vignette + masking flash on each transition */}
      <div className={styles.vignette} />
      <div key={flashKey} className={styles.flash} />

      {/* HUD */}
      {student ? (
        <>
          <button className={styles.backButton} onClick={() => transition(null)}>
            ← All students
          </button>
          <div className={styles.infoPanel}>
            <div className={styles.infoHandle}>{student.handle}</div>
            <div className={styles.infoRow}>Current assignment</div>
            <div className={styles.infoAssignment}>{currentTitle}</div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className={styles.infoRow}>{pct}% complete</div>
          </div>
        </>
      ) : (
        <div className={styles.title}>
          <div className={styles.titleMain}>{demoClass.course.title}</div>
          <div className={styles.titleSub}>
            Select a student to follow their journey
          </div>
        </div>
      )}
    </div>
  );
}
