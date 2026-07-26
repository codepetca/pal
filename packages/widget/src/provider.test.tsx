import assert from "node:assert/strict";
import test from "node:test";
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
