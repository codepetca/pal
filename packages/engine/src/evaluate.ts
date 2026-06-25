import type { IncomingEvent, LearnerState, Mutation, RulePack } from "./types";

// The rule engine — a pure function. No side effects, no DB calls.
// Returns the full list of mutations to apply.
export function evaluate(
  event: IncomingEvent,
  state: LearnerState,
  rulePack: RulePack
): Mutation[] {
  const mutations: Mutation[] = [];

  for (const rule of rulePack.rules) {
    if (rule.trigger.event_type !== event.event_type) continue;
    if (!checkConditions(rule.conditions, event, state)) continue;
    mutations.push(...rule.effects);
  }

  return mutations;
}

function checkConditions(
  conditions: RulePack["rules"][number]["conditions"],
  event: IncomingEvent,
  state: LearnerState
): boolean {
  for (const condition of conditions) {
    const value = resolveField(condition.field, event, state);
    if (!compare(value, condition.op, condition.value)) return false;
  }
  return true;
}

function resolveField(
  field: string,
  event: IncomingEvent,
  state: LearnerState
): unknown {
  if (field.startsWith("metadata.")) return event.metadata[field.slice(9)];
  if (field.startsWith("economy.")) return (state.economy as Record<string, unknown>)[field.slice(8)];
  if (field.startsWith("world.")) return (state.world as Record<string, unknown>)[field.slice(6)];
  return undefined;
}

function compare(actual: unknown, op: "eq" | "gte" | "lte", expected: unknown): boolean {
  if (op === "eq") return actual === expected;
  if (op === "gte") return Number(actual) >= Number(expected);
  if (op === "lte") return Number(actual) <= Number(expected);
  return false;
}
