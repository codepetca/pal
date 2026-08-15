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
