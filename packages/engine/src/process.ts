import { applyMutations } from "./apply";
import { evaluate } from "./evaluate";
import type { IncomingEvent, LearnerState, Mutation, RulePack } from "./types";

// The original event plus three rounds of derived events, then stop. A rule pack
// that cascades deeper is a config bug: we stop and report it rather than looping
// forever.
//
// Four is the depth the default pack needs to settle a levelling cascade:
//   assignment.completed → XP_CHANGED → XP_CHANGED → XP_CHANGED
// Levelling deducts XP, which changes XP again, which can level again — so an
// unbounded cascade would keep going. The limit caps a single event at three
// levels and leaves any surplus XP banked for the learner's next event.
export const MAX_CASCADE_DEPTH = 4;

export type TraceEntry = {
  depth: number;
  event_type: string;
  mutations: Mutation[];
};

export type ProcessResult = {
  state: LearnerState;
  mutations: Mutation[];
  trace: TraceEntry[];
  // Event types that still wanted to fire at the depth limit. Non-empty means the
  // rule pack cascades too deep — the caller should log it to the AuditLog.
  truncated: string[];
};

// Runs one event through the engine, applies the mutations, and feeds every
// derived event back through the engine until the cascade settles.
//
// The engine itself stays pure and knows nothing about this: it never emits an
// event, it only ever answers "given this event and this state, what changes?".
// Orchestration lives here; persistence lives in the caller.
export function processEvent(
  event: IncomingEvent,
  state: LearnerState,
  rulePack: RulePack
): ProcessResult {
  const applied: Mutation[] = [];
  const trace: TraceEntry[] = [];
  const truncated: string[] = [];

  let current = state;
  let queue: IncomingEvent[] = [event];

  for (let depth = 0; queue.length > 0; depth++) {
    if (depth >= MAX_CASCADE_DEPTH) {
      // Only a cascade that would actually have changed something counts as a
      // config bug worth reporting.
      for (const pending of queue) {
        if (evaluate(pending, current, rulePack).length > 0) truncated.push(pending.event_type);
      }
      break;
    }

    const next: IncomingEvent[] = [];
    for (const pending of queue) {
      const mutations = evaluate(pending, current, rulePack);
      trace.push({ depth, event_type: pending.event_type, mutations });
      if (mutations.length === 0) continue;

      const result = applyMutations(current, mutations, pending);
      current = result.state;
      applied.push(...mutations);
      next.push(...result.derived);
    }
    queue = next;
  }

  return { state: current, mutations: applied, trace, truncated };
}
