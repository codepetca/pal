import { createHmac, timingSafeEqual } from "node:crypto";

import {
  defaultRulePack,
  processEvent,
  type IncomingEvent,
  type LearnerState,
  type Mutation,
} from "@pal/engine";

import { initialLearnerState } from "./learner-state";

const SESSION_VERSION = 1;
const SIGNING_CONTEXT = "pal-sandbox-session-v1";

type SessionPayload = {
  version: typeof SESSION_VERSION;
  learnerId: string;
  state: LearnerState;
  processedKeys: string[];
};

export type SandboxWorld = {
  pet: {
    mood: string;
    mood_expires_at: string | null;
    animation_state: string;
  };
  world: { stage: number; objects: string[] };
  economy: {
    xp: number;
    xp_lifetime: number;
    level: number;
    streak: number;
  };
};

export type SandboxSessionResult = {
  session: string;
  world: SandboxWorld;
};

export type SandboxEventResult = SandboxSessionResult & {
  status: "processed" | "duplicate";
  mutations: Mutation[];
};

export class InvalidSandboxSessionError extends Error {
  constructor(message = "Invalid sandbox session") {
    super(message);
    this.name = "InvalidSandboxSessionError";
  }
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(`${SIGNING_CONTEXT}.${payload}`)
    .digest();
}

function encodeSession(payload: SessionPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

function decodeSession(token: string, secret: string): SessionPayload {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) {
    throw new InvalidSandboxSessionError();
  }

  const expected = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new InvalidSandboxSessionError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new InvalidSandboxSessionError();
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as Partial<SessionPayload>).version !== SESSION_VERSION ||
    typeof (payload as Partial<SessionPayload>).learnerId !== "string" ||
    !Array.isArray((payload as Partial<SessionPayload>).processedKeys) ||
    !(payload as Partial<SessionPayload>).state
  ) {
    throw new InvalidSandboxSessionError();
  }

  return payload as SessionPayload;
}

function toWorld(state: LearnerState, now = Date.now()): SandboxWorld {
  const expired =
    state.pet.mood_expires_at !== null &&
    Date.parse(state.pet.mood_expires_at) <= now;

  return {
    pet: {
      mood: expired ? "neutral" : state.pet.mood,
      mood_expires_at: state.pet.mood_expires_at,
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
  };
}

export function createSandboxSession(
  learnerId: string,
  secret: string,
  now = Date.now(),
): SandboxSessionResult {
  const payload: SessionPayload = {
    version: SESSION_VERSION,
    learnerId,
    state: initialLearnerState(),
    processedKeys: [],
  };
  return {
    session: encodeSession(payload, secret),
    world: toWorld(payload.state, now),
  };
}

export function applySandboxEvent(
  token: string,
  request: {
    idempotencyKey: string;
    learnerId: string;
    event: IncomingEvent;
  },
  secret: string,
  now = Date.now(),
): SandboxEventResult {
  const payload = decodeSession(token, secret);
  if (payload.learnerId !== request.learnerId) {
    throw new InvalidSandboxSessionError("Sandbox learner does not match session");
  }

  if (payload.processedKeys.includes(request.idempotencyKey)) {
    return {
      status: "duplicate",
      mutations: [],
      session: token,
      world: toWorld(payload.state, now),
    };
  }

  const result = processEvent(request.event, payload.state, defaultRulePack);
  const nextPayload: SessionPayload = {
    ...payload,
    state: result.state,
    processedKeys: [...payload.processedKeys, request.idempotencyKey],
  };

  return {
    status: "processed",
    mutations: result.mutations,
    session: encodeSession(nextPayload, secret),
    world: toWorld(result.state, now),
  };
}
