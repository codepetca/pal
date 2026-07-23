import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@pal/db";
import { loadLearnerState } from "@/lib/db-learner";
import { learners } from "@pal/db";
import { eq } from "drizzle-orm";

// GET /api/v1/world/:learnerId
// Returns current pet state, world state, and economy for a learner.
// See docs/api.md for the full contract.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> }
) {
  const { learnerId } = await params;

  // TODO: validate read token from Authorization header

  const db = getDb();

  // Resolve the external learner ID to an internal UUID. Without auth we
  // assume the sandbox integration; this becomes a proper lookup once the
  // read token is validated and the integration is resolved from it.
  const learnerRows = await db
    .select({ id: learners.id })
    .from(learners)
    .where(eq(learners.externalLearnerId, learnerId))
    .limit(1);

  if (learnerRows.length === 0) {
    return NextResponse.json({ error: "learner_not_found" }, { status: 404 });
  }

  const state = await loadLearnerState(db, learnerRows[0].id);

  // Moods are temporary: past mood_expires_at, present as "neutral". Read-side
  // presentation only — stored state still changes exclusively via the engine.
  const moodExpired =
    state.pet.mood_expires_at !== null && Date.parse(state.pet.mood_expires_at) <= Date.now();

  return NextResponse.json({
    learnerId,
    pet: {
      mood: moodExpired ? "neutral" : state.pet.mood,
      animation_state: "idle",
    },
    world: {
      stage: state.world.stage,
      objects: state.world.unlocked_object_ids,
    },
    economy: {
      xp: state.economy.xp,
      xp_lifetime: state.economy.xp_lifetime,
      level: state.economy.level,
      streak: state.economy.streak_current,
    },
  });
}
