"use client";

import {
  parsePalWidgetSnapshot,
  type PalFixtureAction,
  type PalFixtureActionContext,
  type PalFixtureController,
  type PalWidgetSnapshot,
} from "@codepet/pal-widget";
import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
} from "@codepet/pal-widget/fixture";
import {
  MAX_FIXTURE_COMMANDS,
  type FixtureStoryCommand,
  type FixtureStoryRequest,
} from "./fixture-story-contract";

export function createStoryFixturePalClient(
  apiBaseUrl: string,
  fetchImplementation: typeof fetch = fetch,
): PalFixtureController {
  const presentation = createFixturePalClient(createEmptyFixtureSnapshot());
  let termWeeks = presentation.peek().roadmap.weeks.length;
  let commands: FixtureStoryCommand[] = [];
  let revision = 0;
  let snapshot = presentation.peek();

  const recordCommand = (command: FixtureStoryCommand) => {
    if (commands.length >= MAX_FIXTURE_COMMANDS) {
      throw new Error("Fixture command limit reached; reset the sandbox to continue");
    }
    commands = [...commands, command];
    revision += 1;
  };

  const project = async (signal?: AbortSignal): Promise<PalWidgetSnapshot> => {
    const requestedRevision = revision;
    const request: FixtureStoryRequest = {
      termWeeks,
      commands: structuredClone(commands),
    };
    const response = await fetchImplementation(
      new URL("/api/sandbox/fixture-story", apiBaseUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Pal fixture projection failed (${response.status})`);
    }
    const projected = parsePalWidgetSnapshot(await response.json());
    if (requestedRevision === revision) snapshot = projected;
    return projected;
  };

  return {
    getSnapshot: project,
    async markRewardSeen(rewardId, signal) {
      await presentation.markRewardSeen(rewardId, signal);
      recordCommand({ type: "acknowledge", rewardId });
      snapshot = {
        ...snapshot,
        rewards: snapshot.rewards.filter((reward) => reward.id !== rewardId),
      };
    },
    dispatch(action: PalFixtureAction, context?: PalFixtureActionContext) {
      const detail = presentation.dispatch(action, context);
      if (action === "reset") {
        commands = [];
        revision += 1;
      } else {
        recordCommand({
          type: "action",
          id: crypto.randomUUID(),
          action,
          ...(context ? { context: structuredClone(context) } : {}),
        });
      }
      snapshot = presentation.peek();
      return detail;
    },
    peek() {
      return structuredClone(snapshot);
    },
    setTermWeeks(weeks) {
      presentation.setTermWeeks?.(weeks);
      termWeeks = weeks;
      commands = [];
      revision += 1;
      snapshot = presentation.peek();
    },
  };
}
