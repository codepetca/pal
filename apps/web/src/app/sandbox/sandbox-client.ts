import type {
  PalFixtureAction,
  PalFixtureController,
  PalWidgetSnapshot,
} from "@pal/widget";

interface CompanionDTO {
  name: string;
  mood: string;
  moodLabel: string;
  level: number;
  streak: number;
  xp: number;
  xpToNextLevel: number;
  message: string;
  assetUrl?: string;
}

/**
 * Creates a sandbox Pal client that uses the fixture client for roadmap
 * state (weeks, achievements) and reads live companion state (XP, level,
 * streak, mood) from the sandbox API after each action.
 *
 * This removes the hardcoded XP approximations from the fixture client
 * and shows real values produced by the rule engine.
 */
export function createSandboxPalClient(
  fixtureClient: PalFixtureController,
): PalFixtureController {
  let lastCompanion: CompanionDTO | null = null;

  async function fetchCompanion(): Promise<CompanionDTO | null> {
    try {
      const res = await fetch("/api/sandbox/snapshot");
      if (!res.ok) return null;
      const data = await res.json();
      return data.companion as CompanionDTO;
    } catch {
      return null;
    }
  }

  // Pre-fetch so the first getSnapshot() call has data.
  void fetchCompanion().then((c) => { lastCompanion = c; });

  return {
    async getSnapshot(signal) {
      const fixtureSnapshot = await fixtureClient.getSnapshot(signal);

      // Fetch live companion data in parallel.
      const companion = lastCompanion ?? (await fetchCompanion());
      lastCompanion = companion;

      if (!companion) {
        // Fallback to the fixture snapshot's companion values.
        return fixtureSnapshot;
      }

      return {
        ...fixtureSnapshot,
        companion: {
          name: companion.name,
          mood: companion.mood as PalWidgetSnapshot["companion"]["mood"],
          moodLabel: companion.moodLabel,
          level: companion.level,
          streak: companion.streak,
          xp: companion.xp,
          xpToNextLevel: companion.xpToNextLevel,
          message: companion.message,
          assetUrl: companion.assetUrl,
        },
      } satisfies PalWidgetSnapshot;
    },

    async markRewardSeen(rewardId, signal) {
      await fixtureClient.markRewardSeen(rewardId, signal);
    },

    dispatch(action: PalFixtureAction) {
      const result = fixtureClient.dispatch(action);
      // Invalidate the cached companion so the next getSnapshot() re-fetches.
      lastCompanion = null;
      return result;
    },

    peek() {
      return fixtureClient.peek();
    },

    setWeek(week: number) {
      fixtureClient.setWeek(week);
      lastCompanion = null;
    },
  };
}