import type {
  PalFixtureAction,
  PalFixtureActionContext,
} from "@codepet/pal-widget";

export const MAX_FIXTURE_COMMANDS = 96;
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

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH
    ? value
    : undefined;
}

function calendarDay(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function context(value: unknown): PalFixtureActionContext | undefined | false {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source || !hasOnlyKeys(source, ["activityDay", "itemToken"])) {
    return false;
  }
  const activityDay = source.activityDay;
  const itemToken = source.itemToken;
  const parsedActivityDay = activityDay === undefined
    ? undefined
    : calendarDay(activityDay);
  if (activityDay !== undefined && parsedActivityDay === undefined) return false;
  if (itemToken !== undefined && boundedText(itemToken) === undefined) return false;
  return {
    ...(parsedActivityDay ? { activityDay: parsedActivityDay } : {}),
    ...(typeof itemToken === "string" ? { itemToken } : {}),
  };
}

export function parseFixtureStoryRequest(value: unknown): FixtureStoryRequest | undefined {
  const source = record(value);
  if (
    !source ||
    !hasOnlyKeys(source, ["termWeeks", "commands"]) ||
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
      if (!hasOnlyKeys(command, ["type", "rewardId"])) return undefined;
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
      !hasOnlyKeys(command, ["type", "id", "action", "context"]) ||
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
