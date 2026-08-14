import { and, eq } from "drizzle-orm";
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
  const [existing] = await db
    .select({ id: titleAwards.id, earnedAt: titleAwards.earnedAt })
    .from(titleAwards)
    .where(
      and(
        eq(titleAwards.learnerId, input.learnerId),
        eq(titleAwards.titleId, input.titleId),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(titleAwards).values(input);
    return;
  }
  if (existing.earnedAt.getTime() <= input.earnedAt.getTime()) return;

  // Delayed facts may reveal that the title was actually earned earlier than
  // the first delivered qualifying event. Preserve chronological truth.
  await db
    .update(titleAwards)
    .set({
      kind: input.kind,
      sourceFactId: input.sourceFactId,
      earnedAt: input.earnedAt,
    })
    .where(eq(titleAwards.id, existing.id));
}
