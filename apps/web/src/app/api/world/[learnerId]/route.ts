import { NextRequest, NextResponse } from "next/server";

// GET /api/world/:learnerId
// Returns current pet state, world state, and economy for a learner.
// See docs/api.md for the full contract.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> }
) {
  const { learnerId } = await params;

  // TODO: validate read token from Authorization header
  // TODO: fetch pet state, world state, economy from DB
  // TODO: resolve pet mood (check expiry, fall back to "neutral")

  return NextResponse.json({
    learnerId,
    pet: { mood: "neutral", animation_state: "idle" },
    world: { stage: 0, objects: [] },
    economy: { xp: 0, level: 1, streak: 0 },
  });
}
