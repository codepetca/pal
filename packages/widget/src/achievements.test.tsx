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
      currentWeek.findAll(
        (node) => node.props.className === "pal-week-current-label",
      ).length,
      1,
    );
    assert.equal(
      currentWeek.find(
        (node) => node.props.className === "pal-week-current-label",
      ).children.join(""),
      "Current week",
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

test("achievement trail centers once for each learner scope", async () => {
  const learnerA = createFixtureSnapshot(4);
  const learnerB = createFixtureSnapshot(4);
  const clientA = createFixturePalClient(learnerA);
  const clientB = createFixturePalClient(learnerB);
  const scrollCalls: ScrollToOptions[] = [];
  const paddingCalls: Array<[string, string]> = [];
  const originalWindow = globalThis.window;
  let renderer: ReactTestRenderer | undefined;

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
    style: {
      setProperty(name: string, value: string) {
        paddingCalls.push([name, value]);
      },
    },
  } as unknown as HTMLOListElement;
  const focalNode = {
    getBoundingClientRect: () => ({ height: 100, top: 500 }) as DOMRect,
    ownerDocument,
    parentElement: roadmapNode,
  } as unknown as HTMLDivElement;

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
        </PalProvider>,
        {
          createNodeMock(element) {
            if (element.type === "ol" &&
              (element.props as Record<string, unknown>).className === "pal-roadmap-list") {
              return roadmapNode;
            }
            return element.type === "div" &&
              (element.props as Record<string, unknown>).className ===
                "pal-week-collectible-stack"
              ? focalNode
              : null;
          },
        },
      );
    });
    assert.equal(scrollCalls.length, 1);
    assert.deepEqual(scrollCalls[0], { behavior: "smooth", top: 250 });
    assert.deepEqual(paddingCalls[0], [
      "--pal-achievement-scroll-padding",
      "150px",
    ]);

    await act(async () => {
      renderer!.update(
        <PalProvider client={clientB} scopeKey="learner-b">
          <PalAchievements />
        </PalProvider>,
      );
      await Promise.resolve();
    });
    assert.equal(scrollCalls.length, 2);
  } finally {
    await act(async () => renderer?.unmount());
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("narrow achievement stories expand from a compact disclosure", async () => {
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
    const storyButton = renderer!.root.find(
      (node) => node.type === "button" &&
        /Week 1: Something Found You/.test(node.props["aria-label"] ?? ""),
    );
    const storyPanel = renderer!.root.find(
      (node) => node.props.className === "pal-week-story-panel",
    );
    assert.equal(storyButton.props["aria-expanded"], false);
    assert.equal(storyPanel.props.hidden, true);

    await act(async () => storyButton.props.onClick());

    assert.equal(storyButton.props["aria-expanded"], true);
    assert.equal(storyPanel.props.hidden, false);
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
