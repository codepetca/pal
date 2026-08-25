import assert from "node:assert/strict";
import test from "node:test";
import { startTransition, Suspense } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PalAchievements } from "./achievements";
import { createFixtureSnapshot } from "./fixture-client";
import { PalProvider, usePalWidget } from "./provider";
import { PalRewardCelebration } from "./reward-celebration";
import type { PalClient, PalWidgetSnapshot } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function snapshotNamed(name: string): PalWidgetSnapshot {
  const snapshot = createFixtureSnapshot();
  snapshot.roadmap.weeks[3]!.label = name;
  return snapshot;
}

const concurrentRendererOptions = {
  unstable_isConcurrent: true,
} as unknown as Parameters<typeof create>[1];

test("a scope change never paints the previous learner snapshot", async () => {
  const learnerA = snapshotNamed("Learner A current week");
  const learnerBRequest = deferred<PalWidgetSnapshot>();
  const clientA: PalClient = {
    getSnapshot: async () => learnerA,
    markRewardSeen: async () => undefined,
  };
  const clientB: PalClient = {
    getSnapshot: () => learnerBRequest.promise,
    markRewardSeen: async () => undefined,
  };
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={clientA}
        initialSnapshot={learnerA}
        scopeKey="learner-a"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Learner A current week/);

  await act(async () => {
    renderer.update(
      <PalProvider client={clientB} scopeKey="learner-b">
        <PalAchievements />
      </PalProvider>,
    );
  });
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Learner A current week/);
  assert.match(JSON.stringify(renderer.toJSON()), /Loading achievements/);

  await act(async () => {
    learnerBRequest.reject(new Error("Learner B unavailable"));
    await learnerBRequest.promise.catch(() => undefined);
  });
  const failedLoad = JSON.stringify(renderer.toJSON());
  assert.doesNotMatch(failedLoad, /Learner A current week/);
  assert.match(failedLoad, /Achievements unavailable/);
});

test("reward loadout writes refresh the equipped snapshot in the same learner scope", async () => {
  const before = createFixtureSnapshot();
  before.rewardLoadout = {
    companion: { options: [] },
    wallpaper: {
      options: [{
        grantId: "grant-wallpaper",
        rewardId: "courtyard-afternoons-v1",
        category: "wallpaper",
        title: "Courtyard Afternoons",
        assetUrl: "/courtyard.png",
      }],
    },
  };
  const after = structuredClone(before);
  after.rewardLoadout!.wallpaper.equippedGrantId = "grant-wallpaper";
  let equipped = false;
  const calls: Array<[string, string | null]> = [];
  const client: PalClient = {
    getSnapshot: async () => equipped ? after : before,
    markRewardSeen: async () => undefined,
    async setRewardLoadout(slot, grantId) {
      calls.push([slot, grantId]);
      equipped = true;
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;
  function Probe() {
    widget = usePalWidget();
    return null;
  }

  await act(async () => {
    create(
      <PalProvider client={client} initialSnapshot={before} scopeKey="loadout-scope">
        <Probe />
      </PalProvider>,
    );
  });
  await act(async () => {
    assert.equal(await widget.setRewardLoadout("wallpaper", "grant-wallpaper"), true);
  });

  assert.deepEqual(calls, [["wallpaper", "grant-wallpaper"]]);
  assert.equal(widget.snapshot?.rewardLoadout?.wallpaper.equippedGrantId, "grant-wallpaper");
  assert.equal(widget.loadoutPending, false);
  assert.equal(widget.loadoutError, null);
});

test("reward acknowledgement is duplicate-safe, recoverable, and removed after success", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Achievement earned",
    description: "A reward notice",
  });
  const firstRequest = deferred<void>();
  let acknowledgementCalls = 0;
  const client: PalClient = {
    getSnapshot: async () => snapshot,
    async markRewardSeen() {
      acknowledgementCalls += 1;
      if (acknowledgementCalls === 1) {
        await firstRequest.promise;
      }
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    renderer = create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="fixture-learner"
      >
        <Probe />
      </PalProvider>,
    );
  });

  let firstDismiss!: Promise<void>;
  await act(async () => {
    firstDismiss = widget.dismissReward("reward-1");
    void widget.dismissReward("reward-1");
    await Promise.resolve();
  });
  assert.equal(acknowledgementCalls, 1);
  assert.equal(widget.isRewardPending("reward-1"), true);

  await act(async () => {
    firstRequest.reject(new Error("Temporary acknowledgement failure"));
    await firstDismiss;
  });
  assert.equal(widget.snapshot?.rewards.length, 1);
  assert.ok(widget.rewardError);
  assert.match(JSON.stringify(renderer.toJSON()), /Try again/);
  assert.match(JSON.stringify(renderer.toJSON()), /Achievement earned/);

  await act(async () => {
    await widget.dismissReward("reward-1");
  });
  assert.equal(acknowledgementCalls, 2);
  assert.equal(widget.snapshot?.rewards.length, 0);
  assert.equal(renderer.toJSON(), null);
});

test("successful acknowledgement refills the bounded reward page", async () => {
  const firstPage = createFixtureSnapshot();
  firstPage.rewards = [{
    id: "reward-1",
    title: "First reward",
    description: "The first bounded-page reward.",
  }];
  const secondPage = structuredClone(firstPage);
  secondPage.rewards = [{
    id: "reward-2",
    title: "Next reward",
    description: "The next reward loaded after acknowledgement.",
  }];
  let acknowledged = false;
  let snapshotCalls = 0;
  const client: PalClient = {
    async getSnapshot() {
      snapshotCalls += 1;
      return acknowledged ? secondPage : firstPage;
    },
    async markRewardSeen() {
      acknowledged = true;
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    create(
      <PalProvider
        client={client}
        initialSnapshot={firstPage}
        scopeKey="fixture-refill"
      >
        <Probe />
      </PalProvider>,
    );
  });

  await act(async () => {
    await widget.dismissReward("reward-1");
  });

  assert.ok(snapshotCalls >= 2);
  assert.deepEqual(
    widget.snapshot?.rewards.map((reward) => reward.id),
    ["reward-2"],
  );
});

test("disabled title projection does not acknowledge canonical grants", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards = [
    {
      id: "title-notice",
      title: "Rhythm Builder earned",
      description: "Show up three days in a row.",
      titleAward: "Rhythm Builder",
    },
    {
      id: "story-notice",
      kind: "story",
      title: "Keep the light on",
      description: "The coldest night arrived.",
      collectibleTitle: "Warming Lantern",
    },
  ];
  const acknowledgements: string[] = [];
  const client: PalClient = {
    getSnapshot: async () => structuredClone(snapshot),
    markRewardSeen: async (rewardId) => {
      acknowledgements.push(rewardId);
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    create(
      <PalProvider client={client} initialSnapshot={snapshot} scopeKey="policy-only">
        <Probe />
      </PalProvider>,
    );
  });

  assert.deepEqual(acknowledgements, []);
  assert.deepEqual(
    widget.snapshot?.rewards.map((reward) => reward.id),
    ["story-notice"],
  );
});

test("a failed automatic refill retries until the next reward loads", async () => {
  const firstPage = createFixtureSnapshot();
  firstPage.rewards = [{
    id: "reward-1",
    title: "First reward",
    description: "The last reward on the visible page.",
  }];
  const nextPage = structuredClone(firstPage);
  nextPage.rewards = [{
    id: "reward-2",
    title: "Next reward",
    description: "The first reward on the next page.",
  }];
  let snapshotCalls = 0;
  const client: PalClient = {
    async getSnapshot() {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return firstPage;
      if (snapshotCalls === 2) throw new Error("Temporary refill failure");
      return nextPage;
    },
    markRewardSeen: async () => undefined,
  };
  const scheduled = new Map<number, () => void>();
  const delays: number[] = [];
  let nextTimerId = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout(timerId: number) {
        scheduled.delete(timerId);
      },
      setTimeout(callback: () => void, delayMs: number) {
        const timerId = ++nextTimerId;
        scheduled.set(timerId, callback);
        delays.push(delayMs);
        return timerId;
      },
    },
  });
  let widget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  try {
    await act(async () => {
      renderer = create(
        <PalProvider
          client={client}
          initialSnapshot={firstPage}
          scopeKey="fixture-refill-retry"
        >
          <Probe />
        </PalProvider>,
      );
    });
    assert.equal(snapshotCalls, 1);

    await act(async () => {
      await widget.dismissReward("reward-1");
      await Promise.resolve();
    });
    assert.equal(snapshotCalls, 2);
    assert.equal(widget.snapshot?.rewards.length, 0);
    assert.deepEqual(delays, [1_000]);

    const retry = scheduled.values().next().value;
    assert.ok(retry);
    await act(async () => {
      retry();
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(snapshotCalls, 3);
    assert.deepEqual(
      widget.snapshot?.rewards.map((reward) => reward.id),
      ["reward-2"],
    );
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("switching learner scope cancels a pending refill retry", async () => {
  const learnerA = createFixtureSnapshot();
  learnerA.rewards = [{
    id: "reward-a",
    title: "Learner A reward",
    description: "The last visible reward for learner A.",
  }];
  const learnerB = createFixtureSnapshot();
  learnerB.rewards = [];
  let learnerACalls = 0;
  const clientA: PalClient = {
    async getSnapshot() {
      learnerACalls += 1;
      if (learnerACalls === 1) return learnerA;
      throw new Error("Learner A refill failure");
    },
    markRewardSeen: async () => undefined,
  };
  const clientB: PalClient = {
    getSnapshot: async () => learnerB,
    markRewardSeen: async () => undefined,
  };
  const scheduled = new Map<number, () => void>();
  let nextTimerId = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout(timerId: number) {
        scheduled.delete(timerId);
      },
      setTimeout(callback: () => void) {
        const timerId = ++nextTimerId;
        scheduled.set(timerId, callback);
        return timerId;
      },
    },
  });
  let widget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe() {
    widget = usePalWidget();
    return null;
  }

  try {
    await act(async () => {
      renderer = create(
        <PalProvider
          client={clientA}
          initialSnapshot={learnerA}
          scopeKey="learner-a"
        >
          <Probe />
        </PalProvider>,
      );
    });
    await act(async () => {
      await widget.dismissReward("reward-a");
      await Promise.resolve();
    });
    assert.equal(learnerACalls, 2);
    const staleRetry = scheduled.values().next().value;
    assert.ok(staleRetry);

    await act(async () => {
      renderer.update(
        <PalProvider client={clientB} scopeKey="learner-b">
          <Probe />
        </PalProvider>,
      );
    });
    assert.equal(scheduled.size, 0);

    await act(async () => {
      staleRetry();
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(learnerACalls, 2);
    assert.deepEqual(widget.snapshot?.rewards, []);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("acknowledgement drains the visible reward page before refilling", async () => {
  const snapshot = createFixtureSnapshot();
  const pendingRewards = [
    {
      id: "achievement-1",
      title: "Achievement 1",
      description: "First achievement notice.",
    },
    {
      id: "grant-1",
      title: "Grant 1",
      description: "First story or title grant.",
    },
    {
      id: "achievement-2",
      title: "Achievement 2",
      description: "Second achievement notice.",
    },
    {
      id: "grant-2",
      title: "Grant 2",
      description: "Second story or title grant.",
    },
  ];
  snapshot.rewards = pendingRewards;
  const acknowledged = new Set<string>();
  let snapshotCalls = 0;
  const client: PalClient = {
    async getSnapshot() {
      snapshotCalls += 1;
      const next = structuredClone(snapshot);
      const achievements = pendingRewards.filter(
        (reward) =>
          reward.id.startsWith("achievement-") &&
          !acknowledged.has(reward.id),
      );
      const grants = pendingRewards.filter(
        (reward) =>
          reward.id.startsWith("grant-") &&
          !acknowledged.has(reward.id),
      );
      next.rewards = Array.from(
        { length: Math.max(achievements.length, grants.length) },
        (_, index) => [achievements[index], grants[index]],
      ).flatMap((rewards) => rewards.filter((reward) => reward !== undefined));
      return next;
    },
    async markRewardSeen(rewardId) {
      acknowledged.add(rewardId);
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="fixture-stable-page"
      >
        <Probe />
      </PalProvider>,
    );
  });

  const consumed: string[] = [];
  const expectedOrder = pendingRewards.map((reward) => reward.id);
  for (const [index, expectedId] of expectedOrder.entries()) {
    assert.equal(widget.snapshot?.rewards[0]?.id, expectedId);
    consumed.push(expectedId);
    await act(async () => {
      await widget.dismissReward(expectedId);
    });
    if (index < expectedOrder.length - 1) {
      await act(async () => {
        await widget.refresh();
      });
    }
  }

  assert.deepEqual(consumed, [
    "achievement-1",
    "grant-1",
    "achievement-2",
    "grant-2",
  ]);
  assert.ok(snapshotCalls >= 2);
});

test("refresh cannot append the next reward before a full page drains", async () => {
  const snapshot = createFixtureSnapshot();
  const allRewards = Array.from({ length: 101 }, (_, index) => ({
    id: `reward-${index + 1}`,
    title: `Reward ${index + 1}`,
    description: "A bounded reward-page notice.",
  }));
  snapshot.rewards = allRewards.slice(0, 100);
  const acknowledged = new Set<string>();
  const client: PalClient = {
    async getSnapshot() {
      const next = structuredClone(snapshot);
      next.rewards = allRewards
        .filter((reward) => !acknowledged.has(reward.id))
        .slice(0, 100);
      return next;
    },
    async markRewardSeen(rewardId) {
      acknowledged.add(rewardId);
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;

  function Probe() {
    widget = usePalWidget();
    return null;
  }

  await act(async () => {
    create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="fixture-full-page"
      >
        <Probe />
      </PalProvider>,
    );
  });

  for (let index = 0; index < 100; index += 1) {
    const rewardId = `reward-${index + 1}`;
    assert.equal(widget.snapshot?.rewards[0]?.id, rewardId);
    await act(async () => {
      await widget.dismissReward(rewardId);
    });
    if (index < 99) {
      await act(async () => {
        await widget.refresh();
      });
      assert.equal(
        widget.snapshot?.rewards.some((reward) => reward.id === "reward-101"),
        false,
      );
    }
  }

  assert.deepEqual(
    widget.snapshot?.rewards.map((reward) => reward.id),
    ["reward-101"],
  );
});

test("a category reshuffle cannot evict an unacknowledged reward", async () => {
  const snapshot = createFixtureSnapshot();
  const achievements = [
    {
      id: "achievement-1",
      title: "Achievement 1",
      description: "The first achievement notice.",
    },
  ];
  const grants = Array.from({ length: 100 }, (_, index) => ({
    id: `grant-${index + 1}`,
    title: `Grant ${index + 1}`,
    description: "A story or title grant.",
  }));
  const acknowledged = new Set<string>();
  const serverPage = () => {
    const pendingAchievements = achievements.filter(
      (reward) => !acknowledged.has(reward.id),
    );
    const pendingGrants = grants.filter(
      (reward) => !acknowledged.has(reward.id),
    );
    return Array.from(
      { length: Math.max(pendingAchievements.length, pendingGrants.length) },
      (_, index) => [pendingAchievements[index], pendingGrants[index]],
    )
      .flatMap((rewards) => rewards.filter((reward) => reward !== undefined))
      .slice(0, 100);
  };
  snapshot.rewards = serverPage();
  const originalIds = snapshot.rewards.map((reward) => reward.id);
  const client: PalClient = {
    async getSnapshot() {
      const next = structuredClone(snapshot);
      next.rewards = serverPage();
      return next;
    },
    async markRewardSeen(rewardId) {
      acknowledged.add(rewardId);
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;

  function Probe() {
    widget = usePalWidget();
    return null;
  }

  await act(async () => {
    create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="fixture-category-reshuffle"
      >
        <Probe />
      </PalProvider>,
    );
  });

  achievements.push({
    id: "achievement-2",
    title: "Achievement 2",
    description: "A newly earned achievement notice.",
  });
  await act(async () => {
    await widget.refresh();
  });
  assert.deepEqual(
    widget.snapshot?.rewards.map((reward) => reward.id),
    originalIds,
  );
  assert.equal(widget.snapshot?.rewards.some((reward) => reward.id === "grant-99"), true);
  assert.equal(
    widget.snapshot?.rewards.some((reward) => reward.id === "achievement-2"),
    false,
  );

  for (const rewardId of originalIds) {
    await act(async () => {
      await widget.dismissReward(rewardId);
    });
  }
  assert.deepEqual(
    widget.snapshot?.rewards.map((reward) => reward.id),
    ["achievement-2", "grant-100"],
  );
});

test("reward modal dismisses from its backdrop and restores its trigger", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Achievement earned",
    description: "A reward notice",
  }, {
    id: "reward-2",
    title: "Second achievement",
    description: "Another reward notice",
  });
  let acknowledgementCalls = 0;
  const client: PalClient = {
    getSnapshot: async () => snapshot,
    markRewardSeen: async () => {
      acknowledgementCalls += 1;
    },
  };
  class FakeElement {
    focusCount = 0;
    isConnected = true;

    focus() {
      this.focusCount += 1;
    }
  }
  const previousFocus = new FakeElement();
  const dialogElement = new FakeElement();
  const openChanges: boolean[] = [];
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const originalHTMLElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "HTMLElement",
  );
  let renderer: ReactTestRenderer | undefined;

  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: FakeElement,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: previousFocus },
  });

  try {
    await act(async () => {
      renderer = create(
        <PalProvider
          client={client}
          initialSnapshot={snapshot}
          scopeKey="fixture-learner"
        >
          <PalRewardCelebration
            modal
            onOpenChange={(open) => openChanges.push(open)}
          />
        </PalProvider>,
        {
          createNodeMock(element) {
            return element.type === "section" ? dialogElement : null;
          },
        },
      );
    });

    const dialog = renderer!.root.findByType("section");
    const backdrop = renderer!.root.findByProps({
      className: "pal-celebration-backdrop",
    });
    assert.equal(dialog.props.role, "dialog");
    assert.equal(dialog.props["aria-modal"], "true");
    assert.equal(dialog.props.tabIndex, -1);
    assert.equal(dialogElement.focusCount, 1);
    assert.equal(renderer!.root.findAllByType("button").length, 0);
    assert.deepEqual(openChanges, [true]);

    let tabPrevented = false;
    await act(async () => {
      dialog.props.onKeyDown({
        key: "Tab",
        preventDefault: () => {
          tabPrevented = true;
        },
      });
    });
    assert.equal(tabPrevented, true);
    assert.equal(dialogElement.focusCount, 2);

    await act(async () => {
      backdrop.props.onClick({ target: {}, currentTarget: {} });
      await Promise.resolve();
    });
    assert.equal(acknowledgementCalls, 0);

    const backdropTarget = {};
    await act(async () => {
      backdrop.props.onClick({
        target: backdropTarget,
        currentTarget: backdropTarget,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(acknowledgementCalls, 1);
    assert.match(JSON.stringify(renderer!.toJSON()), /Second achievement/);
    assert.equal(previousFocus.focusCount, 0);
    assert.deepEqual(openChanges, [true]);

    const nextBackdrop = renderer!.root.findByProps({
      className: "pal-celebration-backdrop",
    });
    const nextBackdropTarget = {};
    await act(async () => {
      nextBackdrop.props.onClick({
        target: nextBackdropTarget,
        currentTarget: nextBackdropTarget,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(acknowledgementCalls, 2);
    assert.equal(renderer!.toJSON(), null);
    assert.equal(previousFocus.focusCount, 1);
    assert.deepEqual(openChanges, [true, false]);

    await act(async () => {
      renderer?.unmount();
      await Promise.resolve();
    });
    assert.equal(previousFocus.focusCount, 1);
    assert.deepEqual(openChanges, [true, false]);
  } finally {
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (originalHTMLElement) {
      Object.defineProperty(globalThis, "HTMLElement", originalHTMLElement);
    } else {
      Reflect.deleteProperty(globalThis, "HTMLElement");
    }
  }
});

test("modal Escape dismissal is duplicate-safe and exposes retry only after failure", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Achievement earned",
    description: "A reward notice",
  });
  const firstAcknowledgement = deferred<void>();
  let acknowledgementCalls = 0;
  const client: PalClient = {
    getSnapshot: async () => snapshot,
    markRewardSeen() {
      acknowledgementCalls += 1;
      return acknowledgementCalls === 1
        ? firstAcknowledgement.promise
        : Promise.resolve();
    },
  };
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="escape-reward"
      >
        <PalRewardCelebration modal />
      </PalProvider>,
    );
  });

  const dialog = renderer.root.findByType("section");
  let escapePrevented = false;
  await act(async () => {
    dialog.props.onKeyDown({
      key: "Escape",
      preventDefault: () => {
        escapePrevented = true;
      },
    });
    await Promise.resolve();
  });
  assert.equal(escapePrevented, true);
  assert.equal(acknowledgementCalls, 1);
  assert.equal(dialog.props["aria-busy"], true);

  const pendingBackdrop = renderer.root.findByProps({
    className: "pal-celebration-backdrop",
  });
  const pendingBackdropTarget = {};
  await act(async () => {
    dialog.props.onKeyDown({ key: "Escape", preventDefault: () => undefined });
    pendingBackdrop.props.onClick({
      target: pendingBackdropTarget,
      currentTarget: pendingBackdropTarget,
    });
    await Promise.resolve();
  });
  assert.equal(acknowledgementCalls, 1);

  await act(async () => {
    firstAcknowledgement.reject(new Error("Temporary acknowledgement failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  const retryButtons = renderer.root.findAllByType("button");
  assert.equal(retryButtons.length, 1);
  assert.equal(retryButtons[0]!.props.children, "Try again");
  assert.equal(retryButtons[0]!.props.disabled, false);
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Continue/);

  await act(async () => {
    retryButtons[0]!.props.onClick();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(acknowledgementCalls, 2);
  assert.equal(renderer.toJSON(), null);
});

test("a refilled reward cancels stale focus restoration", async () => {
  const firstPage = createFixtureSnapshot();
  firstPage.rewards = [{
    id: "reward-1",
    title: "First achievement",
    description: "The final reward on the visible page.",
  }];
  const nextPage = structuredClone(firstPage);
  nextPage.rewards = [{
    id: "reward-2",
    title: "Refilled achievement",
    description: "The first reward on the next page.",
  }];
  const refill = deferred<typeof nextPage>();
  let snapshotCalls = 0;
  const client: PalClient = {
    getSnapshot() {
      snapshotCalls += 1;
      return snapshotCalls === 1 ? Promise.resolve(firstPage) : refill.promise;
    },
    markRewardSeen: async () => undefined,
  };
  class FakeElement {
    focusCount = 0;
    isConnected = true;

    focus() {
      this.focusCount += 1;
    }
  }
  const previousFocus = new FakeElement();
  const dialogElement = new FakeElement();
  const animationFrames: FrameRequestCallback[] = [];
  const openChanges: boolean[] = [];
  const handleOpenChange = (open: boolean) => openChanges.push(open);
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const originalHTMLElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "HTMLElement",
  );
  const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  let widget!: ReturnType<typeof usePalWidget>;
  let renderer: ReactTestRenderer | undefined;

  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: FakeElement,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: previousFocus },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    },
  });

  function Probe() {
    widget = usePalWidget();
    return (
      <PalRewardCelebration
        modal
        onOpenChange={handleOpenChange}
      />
    );
  }

  try {
    await act(async () => {
      renderer = create(
        <PalProvider
          client={client}
          initialSnapshot={firstPage}
          scopeKey="fixture-refill-focus"
        >
          <Probe />
        </PalProvider>,
        {
          createNodeMock(element) {
            return element.type === "section" ? dialogElement : null;
          },
        },
      );
    });
    assert.equal(dialogElement.focusCount, 1);

    await act(async () => {
      await widget.dismissReward("reward-1");
    });
    assert.equal(renderer!.toJSON(), null);
    assert.equal(animationFrames.length, 1);

    animationFrames.shift()?.(0);
    assert.equal(animationFrames.length, 1);

    await act(async () => {
      refill.resolve(nextPage);
      await refill.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.match(JSON.stringify(renderer!.toJSON()), /Refilled achievement/);
    assert.equal(dialogElement.focusCount, 2);
    assert.equal(previousFocus.focusCount, 0);

    animationFrames.shift()?.(16);
    assert.equal(previousFocus.focusCount, 0);
    assert.deepEqual(openChanges, [true, false, true]);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (originalHTMLElement) {
      Object.defineProperty(globalThis, "HTMLElement", originalHTMLElement);
    } else {
      Reflect.deleteProperty(globalThis, "HTMLElement");
    }
    if (originalRequestAnimationFrame) {
      Object.defineProperty(
        globalThis,
        "requestAnimationFrame",
        originalRequestAnimationFrame,
      );
    } else {
      Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    }
  }
});

test("a host-managed reward does not publish a competing open lifecycle", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Achievement earned",
    description: "A reward notice",
  });
  const openChanges: boolean[] = [];

  await act(async () => {
    create(
      <PalProvider
        client={{
          getSnapshot: async () => snapshot,
          markRewardSeen: async () => undefined,
        }}
        initialSnapshot={snapshot}
        scopeKey="fixture-learner"
      >
        <PalRewardCelebration
          hostManaged
          onOpenChange={(open) => openChanges.push(open)}
        />
      </PalProvider>,
    );
  });

  assert.deepEqual(openChanges, []);
});

test("an older snapshot refresh cannot resurrect an acknowledged reward", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Achievement earned",
    description: "A reward notice",
  });
  const staleRefresh = deferred<PalWidgetSnapshot>();
  let snapshotCalls = 0;
  let acknowledgementCalls = 0;
  const client: PalClient = {
    getSnapshot() {
      snapshotCalls += 1;
      return snapshotCalls === 2
        ? staleRefresh.promise
        : Promise.resolve(snapshot);
    },
    async markRewardSeen() {
      acknowledgementCalls += 1;
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="fixture-learner"
      >
        <Probe />
      </PalProvider>,
    );
  });

  let refreshPromise!: Promise<void>;
  await act(async () => {
    refreshPromise = widget.refresh();
    await Promise.resolve();
  });
  await act(async () => {
    await widget.dismissReward("reward-1");
  });
  assert.equal(widget.snapshot?.rewards.length, 0);

  await act(async () => {
    staleRefresh.resolve(snapshot);
    await refreshPromise;
  });
  assert.equal(widget.snapshot?.rewards.length, 0);

  await act(async () => {
    await widget.dismissReward("reward-1");
  });
  assert.equal(acknowledgementCalls, 1);
});

test("a stale scope acknowledgement failure cannot call the new scope error handler", async () => {
  const learnerA = createFixtureSnapshot();
  learnerA.rewards.push({
    id: "reward-a",
    title: "Learner A reward",
    description: "A reward notice",
  });
  const learnerB = createFixtureSnapshot();
  const acknowledgement = deferred<void>();
  const errorsA: Error[] = [];
  const errorsB: Error[] = [];
  const clientA: PalClient = {
    getSnapshot: async () => learnerA,
    markRewardSeen: () => acknowledgement.promise,
  };
  const clientB: PalClient = {
    getSnapshot: async () => learnerB,
    markRewardSeen: async () => undefined,
  };
  let widget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    renderer = create(
      <PalProvider
        client={clientA}
        initialSnapshot={learnerA}
        onError={(error) => errorsA.push(error)}
        scopeKey="learner-a"
      >
        <Probe />
      </PalProvider>,
    );
  });

  let dismissal!: Promise<void>;
  await act(async () => {
    dismissal = widget.dismissReward("reward-a");
    await Promise.resolve();
  });
  await act(async () => {
    renderer.update(
      <PalProvider
        client={clientB}
        initialSnapshot={learnerB}
        onError={(error) => errorsB.push(error)}
        scopeKey="learner-b"
      >
        <Probe />
      </PalProvider>,
    );
  });
  await act(async () => {
    acknowledgement.reject(new Error("Old learner request failed"));
    await dismissal;
  });

  assert.equal(errorsA.length, 0);
  assert.equal(errorsB.length, 0);
  assert.equal(widget.snapshot?.roadmap.semesterLabel, "Fall semester");
});

test("a committed scope switch aborts an in-flight reward acknowledgement", async () => {
  const learnerA = createFixtureSnapshot();
  learnerA.rewards.push({
    id: "reward-a",
    title: "Learner A reward",
    description: "A reward notice",
  });
  const learnerB = createFixtureSnapshot();
  let acknowledgementSignal: AbortSignal | undefined;
  const acknowledgement = deferred<void>();
  const clientA: PalClient = {
    getSnapshot: async () => learnerA,
    markRewardSeen(_rewardId, signal) {
      acknowledgementSignal = signal;
      return acknowledgement.promise;
    },
  };
  const clientB: PalClient = {
    getSnapshot: async () => learnerB,
    markRewardSeen: async () => undefined,
  };
  let widget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    renderer = create(
      <PalProvider
        client={clientA}
        initialSnapshot={learnerA}
        scopeKey="learner-a"
      >
        <Probe />
      </PalProvider>,
    );
  });

  let dismissal!: Promise<void>;
  await act(async () => {
    dismissal = widget.dismissReward("reward-a");
    await Promise.resolve();
  });
  assert.equal(acknowledgementSignal?.aborted, false);

  await act(async () => {
    renderer.update(
      <PalProvider
        client={clientB}
        initialSnapshot={learnerB}
        scopeKey="learner-b"
      >
        <Probe />
      </PalProvider>,
    );
  });
  assert.equal(acknowledgementSignal?.aborted, true);

  await act(async () => {
    acknowledgement.resolve();
    await dismissal;
  });
  assert.equal(widget.snapshot?.roadmap.semesterLabel, "Fall semester");
});

test("returning to a reused scope cannot revive an aborted pending reward", async () => {
  const learnerA = createFixtureSnapshot();
  learnerA.rewards.push({
    id: "reward-a",
    title: "Learner A reward",
    description: "A reward notice",
  });
  const learnerB = createFixtureSnapshot();
  const acknowledgement = deferred<void>();
  const clientA: PalClient = {
    getSnapshot: async () => learnerA,
    markRewardSeen: () => acknowledgement.promise,
  };
  const clientB: PalClient = {
    getSnapshot: async () => learnerB,
    markRewardSeen: async () => undefined,
  };
  let widget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    renderer = create(
      <PalProvider
        client={clientA}
        initialSnapshot={learnerA}
        scopeKey="learner-a"
      >
        <Probe />
      </PalProvider>,
    );
  });
  let dismissal!: Promise<void>;
  await act(async () => {
    dismissal = widget.dismissReward("reward-a");
    await Promise.resolve();
  });
  assert.equal(widget.isRewardPending("reward-a"), true);

  await act(async () => {
    renderer.update(
      <PalProvider
        client={clientB}
        initialSnapshot={learnerB}
        scopeKey="learner-b"
      >
        <Probe />
      </PalProvider>,
    );
  });
  await act(async () => {
    renderer.update(
      <PalProvider
        client={clientA}
        initialSnapshot={learnerA}
        scopeKey="learner-a"
      >
        <Probe />
      </PalProvider>,
    );
  });
  assert.equal(widget.isRewardPending("reward-a"), false);
  assert.match(JSON.stringify(renderer.toJSON()), /Continue/);

  await act(async () => {
    acknowledgement.resolve();
    await dismissal;
  });
});

test("snapshot refresh does not clear a reward acknowledgement retry", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Achievement earned",
    description: "A reward notice",
  });
  let snapshotCalls = 0;
  const failedRefresh = deferred<PalWidgetSnapshot>();
  const client: PalClient = {
    getSnapshot() {
      snapshotCalls += 1;
      return snapshotCalls === 1
        ? Promise.resolve(snapshot)
        : failedRefresh.promise;
    },
    async markRewardSeen() {
      throw new Error("Acknowledgement unavailable");
    },
  };
  let widget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe() {
    widget = usePalWidget();
    return <PalRewardCelebration />;
  }

  await act(async () => {
    renderer = create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="fixture-learner"
      >
        <Probe />
      </PalProvider>,
    );
  });
  await act(async () => {
    await widget.dismissReward("reward-1");
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Try again/);

  let refreshPromise!: Promise<void>;
  await act(async () => {
    refreshPromise = widget.refresh();
    await Promise.resolve();
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Try again/);

  await act(async () => {
    failedRefresh.reject(new Error("Snapshot unavailable"));
    await refreshPromise;
  });
  assert.equal(widget.snapshot?.rewards.length, 1);
  assert.ok(widget.rewardError);
  assert.match(JSON.stringify(renderer.toJSON()), /Try again/);
});

test("an abandoned concurrent scope render cannot swallow the committed scope acknowledgement", async () => {
  const learnerA = createFixtureSnapshot();
  learnerA.rewards.push({
    id: "reward-a",
    title: "Learner A reward",
    description: "A reward notice",
  });
  const learnerB = createFixtureSnapshot();
  learnerB.rewards.push({
    id: "reward-b",
    title: "Learner B reward",
    description: "A different reward notice",
  });
  const acknowledgement = deferred<void>();
  const suspendedScope = deferred<void>();
  const clientA: PalClient = {
    getSnapshot: async () => learnerA,
    markRewardSeen: () => acknowledgement.promise,
  };
  const clientB: PalClient = {
    getSnapshot: async () => learnerB,
    markRewardSeen: async () => undefined,
  };
  let committedWidget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe({ suspend }: { suspend: boolean }) {
    const widget = usePalWidget();
    if (suspend) throw suspendedScope.promise;
    committedWidget = widget;
    return <PalRewardCelebration />;
  }

  function Experience({
    client,
    scopeKey,
    suspend,
  }: {
    client: PalClient;
    scopeKey: string;
    suspend: boolean;
  }) {
    return (
      <Suspense fallback={<span>Loading next learner</span>}>
        <PalProvider
          client={client}
          initialSnapshot={scopeKey === "learner-a" ? learnerA : learnerB}
          scopeKey={scopeKey}
        >
          <Probe suspend={suspend} />
        </PalProvider>
      </Suspense>
    );
  }

  await act(async () => {
    renderer = create(
      <Experience client={clientA} scopeKey="learner-a" suspend={false} />,
      concurrentRendererOptions,
    );
  });

  let dismissal!: Promise<void>;
  await act(async () => {
    dismissal = committedWidget.dismissReward("reward-a");
    await Promise.resolve();
  });
  await act(async () => {
    startTransition(() => {
      renderer.update(
        <Experience client={clientB} scopeKey="learner-b" suspend />,
      );
    });
    await Promise.resolve();
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Learner A reward/);
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Learner B reward/);

  await act(async () => {
    acknowledgement.resolve();
    await dismissal;
  });
  assert.equal(committedWidget.snapshot?.rewards.length, 0);
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Learner A reward/);

  await act(async () => {
    renderer.unmount();
  });
});

test("an abandoned concurrent scope render reports an acknowledgement failure only to the committed scope", async () => {
  const learnerA = createFixtureSnapshot();
  learnerA.rewards.push({
    id: "reward-a",
    title: "Learner A reward",
    description: "A reward notice",
  });
  const learnerB = createFixtureSnapshot();
  const acknowledgement = deferred<void>();
  const suspendedScope = deferred<void>();
  const errorsA: Error[] = [];
  const errorsB: Error[] = [];
  const clientA: PalClient = {
    getSnapshot: async () => learnerA,
    markRewardSeen: () => acknowledgement.promise,
  };
  const clientB: PalClient = {
    getSnapshot: async () => learnerB,
    markRewardSeen: async () => undefined,
  };
  let committedWidget!: ReturnType<typeof usePalWidget>;
  let renderer!: ReactTestRenderer;

  function Probe({ suspend }: { suspend: boolean }) {
    const widget = usePalWidget();
    if (suspend) throw suspendedScope.promise;
    committedWidget = widget;
    return <PalRewardCelebration />;
  }

  function Experience({
    client,
    onError,
    scopeKey,
    suspend,
  }: {
    client: PalClient;
    onError: (error: Error) => void;
    scopeKey: string;
    suspend: boolean;
  }) {
    return (
      <Suspense fallback={<span>Loading next learner</span>}>
        <PalProvider
          client={client}
          initialSnapshot={scopeKey === "learner-a" ? learnerA : learnerB}
          onError={onError}
          scopeKey={scopeKey}
        >
          <Probe suspend={suspend} />
        </PalProvider>
      </Suspense>
    );
  }

  await act(async () => {
    renderer = create(
      <Experience
        client={clientA}
        onError={(error) => errorsA.push(error)}
        scopeKey="learner-a"
        suspend={false}
      />,
      concurrentRendererOptions,
    );
  });

  let dismissal!: Promise<void>;
  await act(async () => {
    dismissal = committedWidget.dismissReward("reward-a");
    await Promise.resolve();
  });
  await act(async () => {
    startTransition(() => {
      renderer.update(
        <Experience
          client={clientB}
          onError={(error) => errorsB.push(error)}
          scopeKey="learner-b"
          suspend
        />,
      );
    });
    await Promise.resolve();
  });

  await act(async () => {
    acknowledgement.reject(new Error("Committed learner acknowledgement failed"));
    await dismissal;
  });
  assert.equal(errorsA.length, 1);
  assert.equal(errorsB.length, 0);
  assert.equal(committedWidget.snapshot?.rewards.length, 1);
  assert.ok(committedWidget.rewardError);
  assert.match(JSON.stringify(renderer.toJSON()), /Try again/);

  await act(async () => {
    renderer.unmount();
  });
});

test("polling schedules the next refresh only after the current one settles", async () => {
  const snapshot = createFixtureSnapshot();
  const polledSnapshot = deferred<PalWidgetSnapshot>();
  let snapshotCalls = 0;
  const client: PalClient = {
    getSnapshot() {
      snapshotCalls += 1;
      return snapshotCalls === 1
        ? Promise.resolve(snapshot)
        : polledSnapshot.promise;
    },
    markRewardSeen: async () => undefined,
  };
  const scheduled: Array<() => Promise<void>> = [];
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout() {},
      setTimeout(callback: () => Promise<void>) {
        scheduled.push(callback);
        return scheduled.length;
      },
    },
  });
  let renderer!: ReactTestRenderer;

  try {
    await act(async () => {
      renderer = create(
        <PalProvider
          client={client}
          initialSnapshot={snapshot}
          refreshIntervalMs={1_000}
          scopeKey="fixture-learner"
        >
          <PalAchievements />
        </PalProvider>,
      );
    });
    assert.equal(scheduled.length, 1);

    let pollingRequest!: Promise<void>;
    await act(async () => {
      pollingRequest = scheduled[0]!();
      await Promise.resolve();
    });
    assert.equal(snapshotCalls, 2);
    assert.equal(scheduled.length, 1);

    await act(async () => {
      polledSnapshot.resolve(snapshot);
      await pollingRequest;
    });
    assert.equal(scheduled.length, 2);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("polling waits for a slow initial refresh before scheduling", async () => {
  const snapshot = createFixtureSnapshot();
  const initialRefresh = deferred<PalWidgetSnapshot>();
  const client: PalClient = {
    getSnapshot: () => initialRefresh.promise,
    markRewardSeen: async () => undefined,
  };
  const scheduled: Array<() => Promise<void>> = [];
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout() {},
      setTimeout(callback: () => Promise<void>) {
        scheduled.push(callback);
        return scheduled.length;
      },
    },
  });
  let renderer!: ReactTestRenderer;

  try {
    await act(async () => {
      renderer = create(
        <PalProvider
          client={client}
          initialSnapshot={snapshot}
          refreshIntervalMs={1_000}
          scopeKey="fixture-learner"
        >
          <PalAchievements />
        </PalProvider>,
      );
      await Promise.resolve();
    });
    assert.equal(scheduled.length, 0);

    await act(async () => {
      initialRefresh.resolve(snapshot);
      await initialRefresh.promise;
    });
    assert.equal(scheduled.length, 1);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
