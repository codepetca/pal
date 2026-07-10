import { NextRequest, NextResponse } from "next/server";
import { getLearnerState } from "@/lib/learner-store";

// GET /api/v1/world/:learnerId
// Returns current pet state, world state, and economy for a learner.
// See docs/api.md for the full contract.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> }
) {
  const { learnerId } = await params;
  const state = getLearnerState(learnerId);

  // TODO: validate read token from Authorization header

  return NextResponse.json({
    learnerId,
    pet: { mood: state.pet.mood, animation_state: "idle" },
    world: { stage: state.world.stage, objects: state.world.unlocked_object_ids },
    economy: { xp: state.economy.xp, level: state.economy.level, streak: state.economy.streak_current },
  });
}
