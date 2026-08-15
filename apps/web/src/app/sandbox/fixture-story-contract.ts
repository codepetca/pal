import type {
  PalFixtureAction,
  PalFixtureActionContext,
} from "@codepet/pal-widget";

const MAX_FIXTURE_COMMANDS = 256;
const MAX_ID_LENGTH = 160;

const FIXTURE_ACTIONS = new Set<Exclude<PalFixtureAction, "reset">>([
  "advance-week",
  "classroom-joined",
  "daily-log-completed",
  "item-opened-early",
  "on-time-finish",
  "late-finish",
  "short-week-configured",
  "week-configured",
  "reward-earned",
  "duplicate-replayed",
  "session-started",
]);

export type FixtureStoryCommand =
  | {
      type: "action";
      id: string;
      action: Exclude<PalFixtureAction, "reset">;
      context?: PalFixtureActionContext;
    }
  | {
      type: "acknowledge";
      rewardId: string;
    };

export interface FixtureStoryRequest {
  termWeeks: number;
  commands: FixtureStoryCommand[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH
    ? value
    : undefined;
}

function context(value: unknown): PalFixtureActionContext | undefined | false {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source) return false;
  const activityDay = source.activityDay;
  const itemToken = source.itemToken;
  if (
    activityDay !== undefined &&
    (typeof activityDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(activityDay))
  ) {
    return false;
  }
  if (itemToken !== undefined && boundedText(itemToken) === undefined) return false;
  return {
    ...(typeof activityDay === "string" ? { activityDay } : {}),
    ...(typeof itemToken === "string" ? { itemToken } : {}),
  };
}

export function parseFixtureStoryRequest(value: unknown): FixtureStoryRequest | undefined {
  const source = record(value);
  if (
    !source ||
    !Number.isInteger(source.termWeeks) ||
    (source.termWeeks as number) < 6 ||
    (source.termWeeks as number) > 24 ||
    !Array.isArray(source.commands) ||
    source.commands.length > MAX_FIXTURE_COMMANDS
  ) {
    return undefined;
  }

  const commands: FixtureStoryCommand[] = [];
  const actionIds = new Set<string>();
  for (const valueCommand of source.commands) {
    const command = record(valueCommand);
    if (!command) return undefined;
    if (command.type === "acknowledge") {
      const rewardId = boundedText(command.rewardId);
      if (!rewardId) return undefined;
      commands.push({ type: "acknowledge", rewardId });
      continue;
    }
    const id = boundedText(command.id);
    const action = command.action;
    const parsedContext = context(command.context);
    if (
      command.type !== "action" ||
      !id ||
      actionIds.has(id) ||
      typeof action !== "string" ||
      !FIXTURE_ACTIONS.has(action as Exclude<PalFixtureAction, "reset">) ||
      parsedContext === false
    ) {
      return undefined;
    }
    actionIds.add(id);
    commands.push({
      type: "action",
      id,
      action: action as Exclude<PalFixtureAction, "reset">,
      ...(parsedContext ? { context: parsedContext } : {}),
    });
  }
  return { termWeeks: source.termWeeks as number, commands };
}
