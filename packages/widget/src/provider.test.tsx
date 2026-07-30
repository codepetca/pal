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
  snapshot.roadmap.semesterLabel = name;
  return snapshot;
}

const concurrentRendererOptions = {
  unstable_isConcurrent: true,
} as unknown as Parameters<typeof create>[1];

test("a scope change never paints the previous learner snapshot", async () => {
  const learnerA = snapshotNamed("Learner A semester");
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
  assert.match(JSON.stringify(renderer.toJSON()), /Learner A semester/);

  await act(async () => {
    renderer.update(
      <PalProvider client={clientB} scopeKey="learner-b">
        <PalAchievements />
      </PalProvider>,
    );
  });
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Learner A semester/);
  assert.match(JSON.stringify(renderer.toJSON()), /Loading achievements/);

  await act(async () => {
    learnerBRequest.reject(new Error("Learner B unavailable"));
    await learnerBRequest.promise.catch(() => undefined);
  });
  const failedLoad = JSON.stringify(renderer.toJSON());
  assert.doesNotMatch(failedLoad, /Learner A semester/);
  assert.match(failedLoad, /Achievements are temporarily unavailable/);
});

test("reward acknowledgement is duplicate-safe, recoverable, and removed after success", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Fish for Pip",
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
  assert.match(JSON.stringify(renderer.toJSON()), /Fish for Pip/);

  await act(async () => {
    await widget.dismissReward("reward-1");
  });
  assert.equal(acknowledgementCalls, 2);
  assert.equal(widget.snapshot?.rewards.length, 0);
  assert.equal(renderer.toJSON(), null);
});

test("reward celebration is a focus-managed dialog that restores its trigger", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Fish for Pip",
    description: "A reward notice",
  });
  const client: PalClient = {
    getSnapshot: async () => snapshot,
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
  const continueButton = new FakeElement();
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
            return element.type === "button" ? continueButton : null;
          },
        },
      );
    });

    const dialog = renderer!.root.findByType("section");
    assert.equal(dialog.props.role, "dialog");
    assert.equal(dialog.props["aria-modal"], "true");
    assert.equal(continueButton.focusCount, 1);
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
    assert.equal(continueButton.focusCount, 2);

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

test("an older snapshot refresh cannot resurrect an acknowledged reward", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.rewards.push({
    id: "reward-1",
    title: "Fish for Pip",
    description: "A reward notice",
  });
  const staleRefresh = deferred<PalWidgetSnapshot>();
  let snapshotCalls = 0;
  let acknowledgementCalls = 0;
  const client: PalClient = {
    getSnapshot() {
      snapshotCalls += 1;
      return snapshotCalls === 1
        ? Promise.resolve(snapshot)
        : staleRefresh.promise;
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
    title: "Fish for Pip",
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
