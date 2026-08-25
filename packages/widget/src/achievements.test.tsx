import assert from "node:assert/strict";
import test from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PalAchievements } from "./achievements";
import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
  createFixtureSnapshot,
} from "./fixture-client";
import { PalProvider } from "./provider";
import type { PalClient } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

test("achievement trail omits future weeks and orders visible weeks newest first", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.roadmap.weeks[3]!.status = "future";
  snapshot.roadmap.weeks[4]!.status = "current";
  const client = createFixturePalClient(snapshot);
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={client}
        initialSnapshot={client.peek()}
        scopeKey="history-inert"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const weeks = renderer!.root.findAll(
      (node) => node.type === "li" && node.props.className === "pal-week",
    );

    assert.deepEqual(
      weeks.map((week) => week.props["data-week-status"]),
      ["current", "past", "past", "past"],
    );
    assert.deepEqual(
      weeks.map((week) =>
        week.find((node) => node.type === "h3").children.join(""),
      ),
      ["Week 4", "Week 3", "Week 2", "Week 1"],
    );
    assert.equal(
      renderer!.root.findAll(
        (node) => node.props["data-week-status"] === "future",
      ).length,
      0,
    );
    assert.equal(
      renderer!.root.findAll((node) => node.props.className === "pal-week-chip")
        .length,
      0,
    );
    assert.equal(
      JSON.stringify(renderer!.toJSON()).includes(snapshot.roadmap.semesterLabel),
      false,
    );
    const badgeControls = renderer!.root.findAll(
      (node) => node.props.className === "pal-badge-control",
    );
    assert.ok(badgeControls.length > 0);
    assert.ok(badgeControls.every((badge) => badge.props.tabIndex === 0));
    assert.ok(
      badgeControls.every((badge) =>
        badge.findAll(
          (node) => node.props.className === "pal-badge-tooltip",
        ).length === 1,
      ),
    );
    const currentRhythm = badgeControls.find(
      (badge) => badge.props["aria-label"] ===
        "Weekly Rhythm — 2 of 4 eligible days",
    )!;
    const progressValue = currentRhythm.find(
      (node) => node.props.className === "pal-badge-progress-value",
    );
    const progressLabel = currentRhythm.find(
      (node) => node.props.className === "pal-badge-progress-label",
    );
    assert.equal(progressValue.props.strokeDasharray, "50 50");
    assert.deepEqual(progressLabel.children, ["2", "/", "4"]);
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("past weeks keep explicit non-earned outcomes without claiming an earned badge", async () => {
  const snapshot = createFixtureSnapshot();
  const weekThree = snapshot.roadmap.weeks.find((week) => week.number === 3)!;
  weekThree.achievements[0]!.status = "incomplete";
  weekThree.achievements[0]!.statusLabel = "Not completed";
  weekThree.achievements[0]!.progress = {
    current: 1,
    target: 3,
    label: "1 of 3 eligible days",
  };
  const client = createFixturePalClient(snapshot);
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={client}
        initialSnapshot={client.peek()}
        scopeKey="past-without-badge"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const weekThreeNode = renderer!.root
      .findAll((node) => node.type === "li" && node.props.className === "pal-week")
      .find((week) =>
        week.findAll((node) => node.type === "h3" && node.children.join("") === "Week 3")
          .length > 0,
      )!;

    const badge = weekThreeNode.find(
      (node) => node.props.className === "pal-badge-control",
    );
    assert.equal(badge.props["data-achievement-result"], "not-earned");
    assert.equal(badge.props["aria-label"], "Weekly Rhythm — Not completed (1 of 3 eligible days)");
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("past in-progress Weekly Rhythm keeps its persisted progress status", async () => {
  const client = createFixturePalClient(createEmptyFixtureSnapshot());
  client.dispatch("daily-log-completed", { activityDay: "2026-04-13" });
  client.dispatch("advance-week");
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={client}
        initialSnapshot={client.peek()}
        scopeKey="past-in-progress"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const badge = renderer!.root.find(
      (node) =>
        node.props.className === "pal-badge-control" &&
        node.props["aria-label"] === "Weekly Rhythm — 1 of 4 eligible days",
    );
    assert.equal(badge.props["data-achievement-result"], "in-progress");
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("clicking the equipped wallpaper collectible clears its loadout slot", async () => {
  const before = createFixtureSnapshot();
  before.progression!.collectibles[0] = {
    id: "courtyard-afternoons-v1",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Brought to life in Week 1",
    title: "Courtyard Afternoons",
    description: "A warm courtyard.",
    kind: "wallpaper",
    finish: "color",
    assetUrl: "/courtyard.png",
  };
  before.rewardLoadout = {
    companion: { options: [] },
    wallpaper: {
      equippedGrantId: "grant-courtyard",
      options: [{
        grantId: "grant-courtyard",
        rewardId: "courtyard-afternoons-v1",
        category: "wallpaper",
        title: "Courtyard Afternoons",
        assetUrl: "/courtyard.png",
      }],
    },
  };
  const after = structuredClone(before);
  delete after.rewardLoadout!.wallpaper.equippedGrantId;
  const calls: Array<[string, string | null]> = [];
  let cleared = false;
  const client: PalClient = {
    getSnapshot: async () => cleared ? after : before,
    markRewardSeen: async () => undefined,
    async setRewardLoadout(slot, rewardGrantId) {
      calls.push([slot, rewardGrantId]);
      cleared = true;
    },
  };
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider client={client} initialSnapshot={before} scopeKey="toggle-wallpaper">
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const equippedButton = renderer!.root.find(
      (node) => node.type === "button" && node.props["data-loadout-equipped"] === "true",
    );
    await act(async () => {
      equippedButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(calls, [["wallpaper", null]]);
    const availableButton = renderer!.root.find(
      (node) => node.type === "button" && node.props["data-loadout-equipped"] === "false",
    );
    assert.equal(availableButton.props["aria-pressed"], false);
    assert.match(availableButton.props["aria-label"], /^Use Courtyard Afternoons/);
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("clicking another usable collectible replaces the active slot selection", async () => {
  const before = createFixtureSnapshot();
  before.progression!.collectibles[0] = {
    id: "lumi-companion-v1",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Brought to life in Week 1",
    title: "Lumi",
    description: "A gentle new friend.",
    kind: "companion",
    finish: "color",
    assetUrl: "/lumi.png",
  };
  before.rewardLoadout = {
    companion: {
      equippedGrantId: "grant-pip",
      options: [
        {
          grantId: "grant-pip",
          rewardId: "young-pip-v1",
          category: "companion",
          title: "Pip",
          assetUrl: "/pip.png",
        },
        {
          grantId: "grant-lumi",
          rewardId: "lumi-companion-v1",
          category: "companion",
          title: "Lumi",
          assetUrl: "/lumi.png",
        },
      ],
    },
    wallpaper: { options: [] },
  };
  const after = structuredClone(before);
  after.rewardLoadout!.companion.equippedGrantId = "grant-lumi";
  after.progression!.companionReveal = { status: "earned", assetUrl: "/lumi.png" };
  after.companion.name = "Lumi";
  const calls: Array<[string, string | null]> = [];
  let equipped = false;
  const client: PalClient = {
    getSnapshot: async () => equipped ? after : before,
    markRewardSeen: async () => undefined,
    async setRewardLoadout(slot, rewardGrantId) {
      calls.push([slot, rewardGrantId]);
      equipped = true;
    },
  };
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider client={client} initialSnapshot={before} scopeKey="replace-companion">
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const lumiButton = renderer!.root.find(
      (node) =>
        node.type === "button" &&
        /Use Lumi as the active companion/.test(node.props["aria-label"] ?? ""),
    );
    await act(async () => {
      lumiButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(calls, [["companion", "grant-lumi"]]);
    const equippedButton = renderer!.root.find(
      (node) =>
        node.type === "button" &&
        node.props["data-loadout-equipped"] === "true",
    );
    assert.equal(equippedButton.props["aria-label"], "Hide Lumi companion");
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("clicking the active fallback companion hides the pet and can show it again", async () => {
  const visible = createFixtureSnapshot();
  visible.progression!.collectibles[0] = {
    id: "young-pip-v1",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Brought to life in Week 1",
    title: "Pip",
    description: "Your first companion.",
    kind: "companion",
    finish: "color",
    assetUrl: "/pip.png",
  };
  visible.rewardLoadout = {
    companion: {
      fallbackGrantId: "grant-pip",
      equippedGrantId: "grant-pip",
      options: [{
        grantId: "grant-pip",
        rewardId: "young-pip-v1",
        category: "companion",
        title: "Pip",
        assetUrl: "/pip.png",
      }],
    },
    wallpaper: { options: [] },
  };
  const hidden = structuredClone(visible);
  hidden.rewardLoadout!.companion.hidden = true;
  const calls: Array<[string, string | null]> = [];
  const visibilityCalls: boolean[] = [];
  let current = visible;
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={{
          getSnapshot: async () => current,
          markRewardSeen: async () => undefined,
          async setRewardLoadout(slot, rewardGrantId) {
            calls.push([slot, rewardGrantId]);
            current = visible;
          },
          async setCompanionVisibility(hiddenValue) {
            visibilityCalls.push(hiddenValue);
            current = hiddenValue ? hidden : visible;
          },
        }}
        initialSnapshot={visible}
        scopeKey="fallback-companion"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const hideButton = renderer!.root.find(
      (node) => node.type === "button" && node.props["aria-label"] === "Hide Pip companion",
    );
    await act(async () => {
      hideButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(visibilityCalls, [true]);
    assert.deepEqual(calls, []);
    const showButton = renderer!.root.find(
      (node) => node.type === "button" && node.props["aria-label"] === "Show Pip companion",
    );
    await act(async () => {
      showButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(visibilityCalls, [true]);
    assert.deepEqual(calls, [["companion", "grant-pip"]]);
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("wallpaper collectibles keep their light artwork in dark mode", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.progression!.collectibles[0] = {
    id: "stream-v1",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Brought to life in Week 1",
    title: "The Stream Beyond",
    description: "A stream beyond the courtyard.",
    kind: "wallpaper",
    finish: "color",
    assetUrl: "/stream-light.png",
    darkAssetUrl: "/stream-dark.png",
  };
  snapshot.rewardLoadout = {
    companion: { options: [] },
    wallpaper: {
      equippedGrantId: "grant-stream",
      options: [{
        grantId: "grant-stream",
        rewardId: "stream-v1",
        category: "wallpaper",
        title: "The Stream Beyond",
        assetUrl: "/stream-light.png",
        darkAssetUrl: "/stream-dark.png",
      }],
    },
  };
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <PalProvider
        client={{
          getSnapshot: async () => snapshot,
          markRewardSeen: async () => undefined,
        }}
        initialSnapshot={snapshot}
        scopeKey="dark-wallpaper-thumbnail"
        theme="dark"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const wallpaper = renderer!.root.find(
      (node) => node.type === "div" && node.props.className === "pal-achievements-wallpaper",
    );
    assert.match(wallpaper.props.style.backgroundImage, /stream-dark\.png/);
    const collectible = renderer!.root.find(
      (node) => node.type === "button" && node.props["data-collectible-kind"] === "wallpaper",
    );
    assert.equal(collectible.findByType("img").props.src, "/stream-light.png");
  } finally {
    await act(async () => renderer?.unmount());
  }
});
