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
  // The learner row lock serializes events. statement_timestamp() records grant
  // order after that lock; snapshot reads group awards sharing sourceFactId so
  // their explicit same-action tie-break applies before individual insert order.
  await db
    .insert(titleAwards)
    .values({ ...input, createdAt: sql`statement_timestamp()` })
    .onConflictDoNothing();
}
