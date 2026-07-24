import { Dashboard, sampleRoadmap } from "@/roadmap";

/**
 * Student viewer — the gamified roadmap.
 *
 * Serves demo data today. To wire real learners, replace `sampleRoadmap`
 * with a fetch (e.g. an adapter over `/api/v1/world/[learnerId]` mapped
 * into RoadmapData). The components don't care where the data comes from.
 */
export default function ViewerPage() {
  return <Dashboard data={sampleRoadmap} />;
}
