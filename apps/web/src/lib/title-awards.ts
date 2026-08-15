import { sql } from "drizzle-orm";
import { titleAwards, type Db } from "@pal/db";

export const BEHAVIOR_TITLES = {
  rhythmBuilder: { id: "rhythm-builder", label: "Rhythm Builder" },
  onTimePro: { id: "on-time-pro", label: "On-Time Pro" },
  levelLeader: { id: "level-leader", label: "Level Leader" },
} as const;

export async function awardLearnerTitle(
  db: Db,
  input: {
    learnerId: string;
    titleId: string;
    kind: "behavior" | "story";
    sourceFactId: string;
    earnedAt: Date;
  },
): Promise<void> {
  // The learner row lock serializes events. transaction_timestamp() gives every
  // title granted by one event the same ordering key, so the snapshot's
  // explicit story-title tie-break decides same-action awards.
  await db
    .insert(titleAwards)
    .values({ ...input, createdAt: sql`transaction_timestamp()` })
    .onConflictDoNothing();
}
