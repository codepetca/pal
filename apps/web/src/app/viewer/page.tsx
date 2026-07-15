"use client";

import dynamic from "next/dynamic";

// The 3D canvas is client-only (WebGL, no SSR).
const ViewerApp = dynamic(() => import("./_components/ViewerApp"), {
  ssr: false,
});

export default function ViewerPage() {
  return <ViewerApp />;
}
