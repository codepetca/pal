import assert from "node:assert/strict";
import test from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PalAchievements } from "./achievements";
import { resolvePalAchievementPresentation } from "./achievement-presentation";
import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
  createFixtureSnapshot,
} from "./fixture-client";
import { PalProvider, usePalWidget } from "./provider";
import type { PalAchievement, PalAchievementKey, PalClient } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const badgeLabelCases: Array<{
  key: PalAchievementKey;
  status: PalAchievement["status"];
  statusLabel: string;
  progress?: PalAchievement["progress"];
  expectedLabel: string;
}> = [
  { key: "joined-class", status: "earned", statusLabel: "Earned", expectedLabel: "Joined the Class" },
  { key: "first-pika-login", status: "earned", statusLabel: "Earned", expectedLabel: "First Pika Login" },
  { key: "ready-early", status: "earned", statusLabel: "Earned early", expectedLabel: "Ready Early" },
  { key: "on-time-finish", status: "earned", statusLabel: "Earned on time", expectedLabel: "On-Time Finish" },
  {
    key: "weekly-rhythm", status: "earned", statusLabel: "Earned",
    progress: { current: 4, target: 4, label: "4 of 4 eligible days" },
    expectedLabel: "Weekly Rhythm",
  },
  {
    key: "weekly-rhythm", status: "in-progress", statusLabel: "In progress",
    progress: { current: 2, target: 4, label: "2 of 4 eligible days" },
    expectedLabel: "Weekly Rhythm — 2 of 4 eligible days",
  },
  {
    key: "weekly-rhythm", status: "in-progress", statusLabel: "Waiting for a schedule update",
    expectedLabel: "Weekly Rhythm — Waiting for a schedule update",
  },
  {
    key: "weekly-rhythm", status: "incomplete", statusLabel: "Not completed",
    progress: { current: 2, target: 4, label: "2 of 4 eligible days" },
    expectedLabel: "Weekly Rhythm — Not completed (2 of 4 eligible days)",
  },
  { key: "ready-early", status: "incomplete", statusLabel: "Opened later", expectedLabel: "Ready Early — Not completed" },
  { key: "on-time-finish", status: "incomplete", statusLabel: "Completed late", expectedLabel: "On-Time Finish — Not completed" },
  { key: "weekly-rhythm", status: "upcoming", statusLabel: "Upcoming", expectedLabel: "Weekly Rhythm — Upcoming" },
];

for (const { key, status, statusLabel, progress, expectedLabel } of badgeLabelCases) {
  test(`badge tooltip and accessible label: ${key}, ${status}, ${progress ? "with" : "without"} progress`, async () => {
    const presentation = resolvePalAchievementPresentation(key)!;
    const snapshot = createEmptyFixtureSnapshot();
    snapshot.roadmap.weeks[0]!.achievements = [{
      id: `badge-label-${key}`,
      ...presentation,
      status,
      statusLabel,
      ...(progress ? { progress } : {}),
    }];
    const client = createFixturePalClient(snapshot);
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <PalProvider client={client} initialSnapshot={client.peek()} scopeKey="badge-label">
          <PalAchievements />
        </PalProvider>,
      );
    });

    try {
      const badge = renderer!.root.findByProps({ className: "pal-badge-control" });
      assert.equal(badge.props["aria-label"], expectedLabel);
      const tooltip = badge.findByProps({ className: "pal-badge-tooltip" });
      assert.equal(tooltip.children.join(""), expectedLabel);
      assert.equal(tooltip.props["aria-hidden"], "true");
      assert.equal(badge.props.role, "img");
      assert.equal(badge.props.tabIndex, 0);
      assert.equal(badge.props["data-achievement-result"], status === "incomplete" ? "not-earned" : status);
      const artwork = badge.findByType("img");
      assert.equal(artwork.props.src, presentation.badge.assetUrl);
      assert.equal(artwork.props.width, "80");
      assert.equal(artwork.props.height, "80");
      assert.equal(artwork.props.alt, "");
      assert.equal(badge.props["data-has-progress"], progress ? "true" : undefined);
      if (progress) {
        assert.equal(badge.findByProps({ className: "pal-badge-progress-label" }).children.join(""), status === "earned" ? "4/4" : "2/4");
        assert.equal(badge.findByProps({ className: "pal-badge-progress-value" }).props.strokeDasharray, status === "earned" ? "100 0" : "50 50");
      } else {
        assert.equal(badge.findAllByProps({ className: "pal-badge-progress-ring" }).length, 0);
        assert.equal(badge.findAllByProps({ className: "pal-badge-progress-label" }).length, 0);
      }
    } finally {
      await act(async () => renderer?.unmount());
    }
  });
}

test("achievement trail omits future weeks and orders visible weeks chronologically", async () => {
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
      ["past", "past", "past", "current"],
    );
    assert.deepEqual(
      weeks.map((week) =>
        week.find((node) => node.type === "h3").children.join(""),
      ),
      ["Week 1", "Week 2", "Week 3", "Week 4"],
    );
    const currentWeek = weeks.at(-1)!;
    assert.equal(currentWeek.props["aria-current"], "step");
    assert.equal(
      renderer!.root.findAll(
        (node) => node.props.className === "pal-week-current-label",
      ).length,
      0,
    );
    assert.equal(
      weeks.slice(0, -1).some((week) => week.props["aria-current"]),
      false,
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

test("achievement trail scrolls to the bottom for each learner and current week", async () => {
  const learnerA = createFixtureSnapshot(4);
  const learnerB = createFixtureSnapshot(4);
  const clientA = createFixturePalClient(learnerA);
  const clientB = createFixturePalClient(learnerB);
  const getClientASnapshot = clientA.getSnapshot.bind(clientA);
  let clientASnapshotCalls = 0;
  clientA.getSnapshot = async (signal) => {
    clientASnapshotCalls += 1;
    return getClientASnapshot(signal);
  };
  const scrollCalls: ScrollToOptions[] = [];
  const originalWindow = globalThis.window;
  let refresh: (() => Promise<void>) | undefined;
  let renderer: ReactTestRenderer | undefined;

  function RefreshCapture() {
    refresh = usePalWidget().refresh;
    return null;
  }

  const body = {} as HTMLElement;
  const documentElement = {} as HTMLElement;
  const ownerDocument = {
    body,
    documentElement,
    defaultView: {
      getComputedStyle(element: HTMLElement) {
        return (element as HTMLElement & {
          style?: { overflowY: string };
        }).style ?? { overflowY: "visible" } as CSSStyleDeclaration;
      },
    },
  } as Document;
  const scrollContainer = {
    clientHeight: 400,
    clientTop: 0,
    getBoundingClientRect: () => ({ top: 100 }) as DOMRect,
    ownerDocument,
    parentElement: body,
    scrollHeight: 1_200,
    scrollTo(options: ScrollToOptions) {
      scrollCalls.push(options);
    },
    scrollTop: 0,
    style: { overflowY: "auto" },
  } as unknown as HTMLElement;
  const roadmapNode = {
    ownerDocument,
    parentElement: scrollContainer,
  } as unknown as HTMLOListElement;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      cancelAnimationFrame() {},
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame(callback: FrameRequestCallback) {
        callback(0);
        return 1;
      },
    },
  });

  try {
    await act(async () => {
      renderer = create(
        <PalProvider
          client={clientA}
          initialSnapshot={learnerA}
          scopeKey="learner-a"
        >
          <PalAchievements />
          <RefreshCapture />
        </PalProvider>,
        {
          createNodeMock(element) {
            if (element.type === "ol" &&
              (element.props as Record<string, unknown>).className === "pal-roadmap-list") {
              return roadmapNode;
            }
            return null;
          },
        },
      );
    });
    assert.equal(scrollCalls.length, 1);
    assert.deepEqual(scrollCalls[0], { behavior: "smooth", top: 800 });

    const snapshotCallsBeforeRefresh = clientASnapshotCalls;
    await act(async () => refresh?.());
    assert.equal(clientASnapshotCalls, snapshotCallsBeforeRefresh + 1);

    await act(async () => {
      renderer!.update(
        <PalProvider
          client={clientA}
          initialSnapshot={learnerA}
          motion="reduced"
          scopeKey="learner-a"
        >
          <PalAchievements />
          <RefreshCapture />
        </PalProvider>,
      );
      await Promise.resolve();
    });
    assert.equal(scrollCalls.length, 1);

    clientA.dispatch("advance-week");
    await act(async () => refresh?.());
    assert.equal(scrollCalls.length, 2);

    await act(async () => {
      renderer!.update(
        <PalProvider client={clientB} scopeKey="learner-b">
          <PalAchievements />
          <RefreshCapture />
        </PalProvider>,
      );
      await Promise.resolve();
    });
    assert.equal(scrollCalls.length, 3);
  } finally {
    await act(async () => renderer?.unmount());
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("narrow achievement stories remain permanently visible", async () => {
  const snapshot = createFixtureSnapshot(2);
  snapshot.progression!.collectibles[0] = {
    id: "earned-week-one",
    chapterId: "egg-arrives",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Earned",
    title: "Mystery Egg",
    description: "An earned keepsake.",
    revealHeadline: "Something Found You",
    storyCopy: "A heavy storm passed over the town during the night.",
    kind: "room",
    finish: "color",
    assetUrl: "/assets/world/reward-mystery-egg-v1.png",
  };
  const client = createFixturePalClient(snapshot);
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="narrow-story-disclosure"
        viewport="narrow"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const story = renderer!.root.find(
      (node) => node.props.className === "pal-week-story",
    );
    assert.equal(story.props["aria-label"], "Week 1 story");
    assert.equal(story.findAll((node) => node.type === "button").length, 0);
    assert.equal(
      story.find((node) => node.type === "p").children.join(""),
      "A heavy storm passed over the town during the night.",
    );
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("achievement trail prefers previews and lazy-loads past collectible art", async () => {
  const snapshot = createFixtureSnapshot(3);
  snapshot.progression!.collectibles[0] = {
    id: "past-preview",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Earned",
    title: "Past collectible",
    description: "A past collectible.",
    kind: "keepsake",
    assetUrl: "/past-full.png",
    previewAssetUrl: "/past-preview.webp",
  };
  snapshot.progression!.collectibles[2] = {
    id: "current-preview",
    roadmapWeek: 3,
    status: "earned",
    statusLabel: "Earned",
    title: "Current collectible",
    description: "The current collectible.",
    kind: "wallpaper",
    assetUrl: "/current-full.png",
    darkAssetUrl: "/current-dark-full.png",
    previewAssetUrl: "/current-preview.webp",
    darkPreviewAssetUrl: "/current-dark-preview.webp",
  };
  const client = createFixturePalClient(snapshot);
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={client}
        initialSnapshot={snapshot}
        scopeKey="preview-art"
        theme="dark"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const past = renderer!.root.find(
      (node) => node.type === "img" && node.props.src === "/past-preview.webp",
    );
    const current = renderer!.root.find(
      (node) => node.type === "img" &&
        node.props.src === "/current-dark-preview.webp",
    );
    assert.equal(past.props.loading, "lazy");
    assert.equal(past.props.decoding, "async");
    assert.equal(current.props.loading, "eager");
    assert.equal(current.props.decoding, "async");
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

test("clicking the equipped companion leaves the companion slot empty", async () => {
  const before = createFixtureSnapshot();
  before.progression!.collectibles[0] = {
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
  before.rewardLoadout = {
    companion: {
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
  const after = structuredClone(before);
  delete after.rewardLoadout!.companion.equippedGrantId;
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
      <PalProvider client={client} initialSnapshot={before} scopeKey="unequip-companion">
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    const equippedButton = renderer!.root.find(
      (node) =>
        node.type === "button" &&
        /Stop using Pip as the active companion/.test(node.props["aria-label"] ?? ""),
    );
    await act(async () => {
      equippedButton.props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(calls, [["companion", null]]);
    const availableButton = renderer!.root.find(
      (node) =>
        node.type === "button" &&
        /Use Pip as the active companion/.test(node.props["aria-label"] ?? ""),
    );
    assert.equal(availableButton.props["aria-pressed"], false);
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
    assert.match(equippedButton.props["aria-label"], /^Stop using Lumi/);
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("the active fallback companion is presented as a non-toggleable default", async () => {
  const snapshot = createFixtureSnapshot();
  snapshot.progression!.collectibles[0] = {
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
  snapshot.rewardLoadout = {
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
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <PalProvider
        client={{
          getSnapshot: async () => snapshot,
          markRewardSeen: async () => undefined,
        }}
        initialSnapshot={snapshot}
        scopeKey="fallback-companion"
      >
        <PalAchievements />
      </PalProvider>,
    );
  });

  try {
    assert.equal(
      renderer!.root.findAll(
        (node) => node.type === "button" && /Pip/.test(node.props["aria-label"] ?? ""),
      ).length,
      0,
    );
    const fallback = renderer!.root.find(
      (node) => node.type === "div" && node.props["aria-label"] === "Pip is the default active companion",
    );
    assert.ok(fallback);
  } finally {
    await act(async () => renderer?.unmount());
  }
});
