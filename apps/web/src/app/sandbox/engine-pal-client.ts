import {
  createFixturePalClient,
  type PalCompanionMood,
  type PalFixtureAction,
  type PalFixtureController,
  type PalWidgetSnapshot,
} from "@codepet/pal-widget";

// Mirrors LEVEL_UP_COST_XP in the engine's default rule pack, for the progress
// readout only. The engine stays the sole authority on when a level-up fires.
const LEVEL_UP_COST_XP = 500;

type WorldResponse = {
  pet: {
    mood: string;
    mood_expires_at: string | null;
    animation_state: string;
  };
  world: { stage: number; objects: string[] };
  economy: { xp: number; xp_lifetime: number; level: number; streak: number };
};

type SandboxSessionResponse = {
  session: string;
  world: WorldResponse;
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

type EnginePalClientOptions = {
  learnerId?: string;
  onWriteError?: (error: Error) => void;
};

type EngineEventRequest = {
  idempotency_key: string;
  learner_id: string;
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

function sessionLearnerId() {
  return `sandbox-${crypto.randomUUID()}`;
}

/**
 * A sandbox client whose companion comes from the rule engine.
 *
 * The roadmap and reward surfaces stay on the fixture — they need the v1
 * receiver before they can be real — but the pet is driven end to end: the
 * controls POST actual events through the sandbox route, the engine decides
 * what they mean, and the resulting state returns in a server-signed session.
 * Nothing here chooses a mood; it only expires and reports the engine's result.
 */
export function createEnginePalClient(
  options: EnginePalClientOptions = {},
): PalFixtureController {
  const fixture = createFixturePalClient();
  const learnerId = options.learnerId ?? sessionLearnerId();

  let lastRequest: EngineEventRequest | null = null;
  let sessionToken: string | null = null;
  let engineWorld: WorldResponse | null = null;

  // Left null until the first read so nothing fetches during SSR, where a
  // relative URL has no origin to resolve against.
  let queue: Promise<unknown> | null = null;

  async function post<T>(
    path: string,
    body: unknown,
    operation: string,
  ): Promise<T> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Pal could not ${operation} (${response.status})`);
    }
    return (await response.json()) as T;
  }

  // Each page load starts from a known, signed state. A fresh token makes the
  // demo repeatable without relying on whichever serverless process happens to
  // receive the next request.
  async function resetLearner() {
    const result = await post<SandboxSessionResponse>(
      "/api/sandbox/reset",
      { learner_id: learnerId },
      "reset the sandbox learner",
    );
    sessionToken = result.session;
    engineWorld = result.world;
  }

  async function resetLearnerAndClearReplay() {
    await resetLearner();
    // Reset is queued behind any write already in flight. Clear again only
    // after it reaches the server, otherwise an earlier send can finish after
    // dispatch("reset") and make its request replayable in the fresh session.
    lastRequest = null;
  }

  async function send(eventType: string, metadata: Record<string, unknown>) {
    const request: EngineEventRequest = {
      idempotency_key: `sandbox-${crypto.randomUUID()}`,
      learner_id: learnerId,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      metadata,
    };
    if (!sessionToken) {
      throw new Error("Pal could not send the sandbox event (missing session)");
    }
    const result = await post<SandboxSessionResponse>(
      "/api/sandbox/events",
      { session: sessionToken, event: request },
      "send the sandbox event",
    );
    sessionToken = result.session;
    engineWorld = result.world;
    // A request is replayable only after the engine accepted it. Remembering a
    // failed write would make Replay retry a request that created no progress.
    lastRequest = request;
  }

  async function replay() {
    if (!lastRequest || !sessionToken) return;
    const result = await post<SandboxSessionResponse>(
      "/api/sandbox/events",
      { session: sessionToken, event: lastRequest },
      "replay the sandbox event",
    );
    sessionToken = result.session;
    engineWorld = result.world;
  }

  // Writes go on one chain and reads wait for it. The controls dispatch
  // synchronously and refresh immediately after, so without this the read could
  // overtake the write it was meant to observe and report a stale mood.
  function enqueue(work: () => Promise<unknown>) {
    const start = queue ? queue.catch(() => undefined) : resetLearner();
    queue = start.then(work).catch((reason: unknown) => {
      const error =
        reason instanceof Error ? reason : new Error("Sandbox write failed");
      options.onWriteError?.(error);
      throw error;
    });
  }

  return {
    async getSnapshot(signal) {
      if (!queue) {
        enqueue(async () => undefined);
      }
      await queue;

      const base = await fixture.getSnapshot(signal);
      if (!engineWorld) {
        throw new Error("Pal could not read the sandbox world (missing session)");
      }
      const moodExpired =
        engineWorld.pet.mood_expires_at !== null &&
        Date.parse(engineWorld.pet.mood_expires_at) <= Date.now();
      const mood = moodExpired ? "neutral" : toMood(engineWorld.pet.mood);

      return {
        ...base,
        companion: {
          name: "Pip",
          mood,
          moodLabel: mood[0].toUpperCase() + mood.slice(1),
          level: engineWorld.economy.level,
          streak: engineWorld.economy.streak,
          message: `${MOOD_COPY[mood]} ${engineWorld.economy.xp} of ${LEVEL_UP_COST_XP} XP toward the next level.`,
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
          // Disable Replay immediately as well as after the queued reset. The
          // second clear in resetLearnerAndClearReplay closes the in-flight race.
          lastRequest = null;
          enqueue(resetLearnerAndClearReplay);
          return "Fixture reset queued";
        case "daily-log-completed":
          enqueue(() => send("daily_log.completed", {}));
          return "daily_log.completed queued for the engine";
        case "on-time-finish":
          enqueue(() => send("learning_item.completed", { on_time: true }));
          return "learning_item.completed queued for the engine";
        case "duplicate-replayed":
          if (!lastRequest) {
            return "Nothing to replay yet — send an engine event first";
          }
          enqueue(async () => {
            await replay();
          });
          return "Exact prior request queued again — the engine must ignore it";
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
