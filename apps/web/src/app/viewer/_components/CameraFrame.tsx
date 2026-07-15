"use client";

// Positions the camera to frame an island of a given radius. Runs when the
// radius changes (student switch) so each island is nicely composed.

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

export function CameraFrame({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    // OrbitControls re-derives its orbit from camera.position each frame, so
    // setting it here reframes cleanly without fighting the controls.
    const d = radius * 2.2 + 9;
    camera.position.set(d * 0.72, d * 0.6, d * 0.72);
    camera.lookAt(0, 1, 0);
    camera.updateProjectionMatrix();
  }, [radius, camera]);
  return null;
}
