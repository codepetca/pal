import type {
  PalCompanionMood,
  PalFixtureAction,
  PalFixtureController,
  PalWidgetSnapshot,
} from "@codepet/pal-widget";

const LEVEL_UP_COST_XP = 500;
const COMPANION_MOODS = new Set<PalCompanionMood>([
  "neutral",
  "happy",
  "excited",
  "sleeping",
]);

type WorldResponse = {
  pet: { mood: string; animation_state: string };
  world: { stage: number; objects: string[] };
  economy: { xp: number; xp_lifetime: number; level: number; streak: number };
};

function toMood(value: string): PalCompanionMood {
  return COMPANION_MOODS.has(value as PalCompanionMood)
    ? (value as PalCompanionMood)
    : "neutral";
}

function moodMessage(mood: PalCompanionMood): string {
  switch (mood) {
    case "excited":
      return "Pip is excited!";
    case "happy":
      return "Pip is happy.";
    case "sleeping":
      return "Pip is sleeping.";
    default:
      return "Pip is feeling neutral.";
  }
}

function companionFromWorld(world: WorldResponse): PalWidgetSnapshot["companion"] {
  const mood = toMood(world.pet.mood);
  return {
    name: "Pip",
    mood,
    moodLabel: mood[0].toUpperCase() + mood.slice(1),
    level: world.economy.level,
    streak: world.economy.streak,
    xp: world.economy.xp,
    xpToNextLevel: Math.max(0, LEVEL_UP_COST_XP - world.economy.xp),
    message: moodMessage(mood),
    assetUrl: "/assets/pets/default.png",
  };
}

/**
 * Composes fixture roadmap/reward state with companion state read from the
 * persisted rule-engine world for one browser-scoped sandbox learner.
 */
export function createSandboxPalClient(
  fixtureClient: PalFixtureController,
  learnerId: string,
): PalFixtureController {
  return {
    async getSnapshot(signal) {
      const [fixtureSnapshot, response] = await Promise.all([
        fixtureClient.getSnapshot(signal),
        fetch(`/api/v1/world/${encodeURIComponent(learnerId)}`, { signal }),
      ]);

      if (response.status === 404) {
        return {
          ...fixtureSnapshot,
          companion: companionFromWorld({
            pet: { mood: "neutral", animation_state: "idle" },
            world: { stage: 0, objects: [] },
            economy: { xp: 0, xp_lifetime: 0, level: 1, streak: 0 },
          }),
        };
      }
      if (!response.ok) {
        throw new Error(`Pal could not load persisted sandbox state (${response.status})`);
      }

      const world = (await response.json()) as WorldResponse;
      return {
        ...fixtureSnapshot,
        companion: companionFromWorld(world),
      } satisfies PalWidgetSnapshot;
    },

    markRewardSeen(rewardId, signal) {
      return fixtureClient.markRewardSeen(rewardId, signal);
    },

    dispatch(action: PalFixtureAction) {
      return fixtureClient.dispatch(action);
    },

    peek() {
      const fixtureSnapshot = fixtureClient.peek();
      return {
        ...fixtureSnapshot,
        companion: companionFromWorld({
          pet: { mood: "neutral", animation_state: "idle" },
          world: { stage: 0, objects: [] },
          economy: { xp: 0, xp_lifetime: 0, level: 1, streak: 0 },
        }),
      };
    },

    setWeek(week: number) {
      fixtureClient.setWeek?.(week);
    },
  };
}
