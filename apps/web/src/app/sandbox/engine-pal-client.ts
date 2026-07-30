import {
  createFixturePalClient,
  type PalCompanionMood,
  type PalFixtureAction,
  type PalFixtureController,
  type PalWidgetSnapshot,
} from "@codepet/pal-widget";

// The sandbox drives one fixed learner. The id is opaque and carries nothing
// about a student, which is what crossing the ingest API requires.
const LEARNER_ID = "sandbox-learner-001";

// Mirrors LEVEL_UP_COST_XP in the engine's default rule pack, for the progress
// readout only. The engine stays the sole authority on when a level-up fires.
const LEVEL_UP_COST_XP = 500;

type WorldResponse = {
  pet: { mood: string; animation_state: string };
  world: { stage: number; objects: string[] };
  economy: { xp: number; xp_lifetime: number; level: number; streak: number };
};

const COMPANION_MOODS = new Set(["neutral", "happy", "excited", "sleeping"]);

// A rule pack can name a mood the widget has no art or label for. Falling back
// to neutral rests the pet rather than blanking it out.
function toMood(value: string): PalCompanionMood {
  return COMPANION_MOODS.has(value) ? (value as PalCompanionMood) : "neutral";
}

const MOOD_COPY: Record<PalCompanionMood, string> = {
  neutral: "Pip is resting.",
  happy: "Recent work has Pip happy.",
  excited: "A level-up has Pip excited!",
  sleeping: "Pip is asleep.",
};

/**
 * A sandbox client whose companion comes from the rule engine.
 *
 * The roadmap and reward surfaces stay on the fixture — they need the v1
 * receiver before they can be real — but the pet is driven end to end: the
 * controls POST actual events through the sandbox proxy, the engine decides
 * what they mean, and the companion is read back from
 * `GET /api/v1/world/:learnerId`. Nothing here chooses a mood; that is the
 * engine's call and this only reports it.
 */
export function createEnginePalClient(): PalFixtureController {
  const fixture = createFixturePalClient();

  let lastKey: string | null = null;

  // Left null until the first read so nothing fetches during SSR, where a
  // relative URL has no origin to resolve against.
  let queue: Promise<unknown> | null = null;

  function post(path: string, body: unknown) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // Each page load starts from a known state. The learner store is in-memory and
  // process-local, so without this a refresh would silently inherit the XP and
  // level left by the previous session and the run-up to a level-up could not be
  // watched from a fixed starting point.
  function resetLearner() {
    return post("/api/sandbox/reset", { learner_id: LEARNER_ID });
  }

  function send(
    eventType: string,
    metadata: Record<string, unknown>,
    replayLastKey = false,
  ) {
    const key =
      replayLastKey && lastKey
        ? lastKey
        : `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    lastKey = key;
    return post("/api/sandbox/events", {
      idempotency_key: key,
      learner_id: LEARNER_ID,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      metadata,
    });
  }

  // Writes go on one chain and reads wait for it. The controls dispatch
  // synchronously and refresh immediately after, so without this the read could
  // overtake the write it was meant to observe and report a stale mood.
  function enqueue(work: () => Promise<unknown>) {
    const start = queue ?? (queue = resetLearner());
    queue = start.then(work, work);
  }

  return {
    async getSnapshot(signal) {
      queue ??= resetLearner();
      await queue;

      const [base, res] = await Promise.all([
        fixture.getSnapshot(signal),
        fetch(`/api/v1/world/${LEARNER_ID}`, { signal }),
      ]);
      if (!res.ok) {
        throw new Error(`Pal could not read the sandbox world (${res.status})`);
      }
      const world = (await res.json()) as WorldResponse;
      const mood = toMood(world.pet.mood);

      return {
        ...base,
        companion: {
          name: "Pip",
          mood,
          moodLabel: mood[0].toUpperCase() + mood.slice(1),
          level: world.economy.level,
          streak: world.economy.streak,
          message: `${MOOD_COPY[mood]} ${world.economy.xp} of ${LEVEL_UP_COST_XP} XP toward the next level.`,
          assetUrl: "/assets/pets/default.png",
        },
      };
    },

    markRewardSeen(rewardId, signal) {
      return fixture.markRewardSeen(rewardId, signal);
    },

    dispatch(action: PalFixtureAction) {
      // The fixture still runs for every action, because the roadmap and reward
      // surfaces read from it. Only the pet-bearing actions also reach the engine.
      const fixtureResult = fixture.dispatch(action);

      switch (action) {
        case "reset":
          lastKey = null;
          enqueue(resetLearner);
          return "Fixture reset, and the engine learner cleared";
        case "daily-log-completed":
          enqueue(() => send("daily_log.completed", {}));
          return "daily_log.completed sent to the engine";
        case "on-time-finish":
          enqueue(() => send("learning_item.completed", { on_time: true }));
          return "learning_item.completed sent to the engine";
        case "duplicate-replayed":
          enqueue(() => send("learning_item.completed", { on_time: true }, true));
          return "Replayed the last idempotency key — the engine must ignore it";
        default:
          return fixtureResult;
      }
    },

    peek(): PalWidgetSnapshot {
      // Runs during SSR as the provider's initial snapshot, so it cannot fetch.
      // The pet starts neutral and at rest rather than borrowing the fixture's
      // mood, which would flash a pose the engine has not reported.
      const base = fixture.peek();
      return {
        ...base,
        companion: {
          ...base.companion,
          mood: "neutral",
          moodLabel: "Neutral",
          level: 1,
          streak: 0,
          message: MOOD_COPY.neutral,
        },
      };
    },
  };
}
