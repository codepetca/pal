"use client";

// A soft vertical-gradient sky rendered inside the scene (a big inward-facing
// sphere), so it reads in both the app and headless captures. Calm pastel
// blend, no sun — Apple-keynote backdrop.

import { useMemo } from "react";
import * as THREE from "three";

export function GradientSky({
  top,
  bottom,
  radius = 300,
}: {
  top: string;
  bottom: string;
  radius?: number;
}) {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(top) },
        bottomColor: { value: new THREE.Color(bottom) },
        offset: { value: radius * 0.35 },
        scale: { value: radius },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPosition = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float scale;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = clamp(h * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }
      `,
    });
  }, [top, bottom, radius]);

  return (
    <mesh material={material}>
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  );
}
