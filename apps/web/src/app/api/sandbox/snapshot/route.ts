import { NextResponse } from "next/server";
import { loadLearnerFromDb } from "@/lib/db-learner";

// The sandbox test learner ID — matches the constant in WidgetSandbox.tsx.
const TEST_LEARNER_ID = "test-learner-001";

// Must match the engine's LEVEL_UP_COST_XP in packages/engine/src/default-rules.ts.
const LEVEL_UP_COST_XP = 500;

function moodLabel(mood: string): string {
  switch (mood) {
    case "excited": return "Excited";
    case "happy": return "Happy";
    case "sleeping": return "Sleeping";
    default: return "Neutral";
  }
}

function moodMessage(mood: string): string {
  switch (mood) {
    case "excited": return "Pip is excited!";
    case "happy": return "Pip is happy.";
    case "sleeping": return "Pip is sleeping.";
    default: return "Pip is feeling neutral.";
  }
}

// GET /api/sandbox/snapshot
// Returns the companion state from the DB for the sandbox test learner.
// Dev-only: read by the sandbox client so the XP bar and companion widget
// show real values from the rule engine, not approximations.
export async function GET() {
  const state = await loadLearnerFromDb(TEST_LEARNER_ID);

  if (!state) {
    // No events yet — return default state.
    return NextResponse.json({
      companion: {
        name: "Pip",
        mood: "neutral",
        moodLabel: "Neutral",
        level: 1,
        streak: 0,
        xp: 0,
        xpToNextLevel: LEVEL_UP_COST_XP,
        message: "Pip is waiting for your first activity.",
        assetUrl: "/assets/pets/default.png",
      },
    });
  }

  const moodExpired =
    state.pet.mood_expires_at !== null &&
    Date.parse(state.pet.mood_expires_at) <= Date.now();
  const mood = moodExpired ? "neutral" : state.pet.mood;

  const xpToNextLevel = Math.max(0, LEVEL_UP_COST_XP - state.economy.xp);

  return NextResponse.json({
    companion: {
      name: "Pip",
      mood,
      moodLabel: moodLabel(mood),
      level: state.economy.level,
      streak: state.economy.streak_current,
      xp: state.economy.xp,
      xpToNextLevel,
      message: moodMessage(mood),
      assetUrl: "/assets/pets/default.png",
    },
  });
}