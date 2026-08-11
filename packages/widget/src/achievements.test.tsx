import assert from "node:assert/strict";
import test from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PalAchievements } from "./achievements";
import { createFixturePalClient, createFixtureSnapshot } from "./fixture-client";
import { PalProvider } from "./provider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

test("achievement trail omits future weeks and orders visible weeks newest first", async () => {
  const client = createFixturePalClient();
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
  } finally {
    await act(async () => renderer?.unmount());
  }
});

test("past weeks without earned achievements do not claim a badge", async () => {
  const snapshot = createFixtureSnapshot();
  const weekThree = snapshot.roadmap.weeks.find((week) => week.number === 3)!;
  weekThree.achievements[0]!.status = "incomplete";
  weekThree.achievements[0]!.statusLabel = "Not completed";
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

    assert.equal(
      weekThreeNode.findAll(
        (node) =>
          node.props.className === "pal-week-earned" ||
          node.props.className === "pal-earned-badges",
      ).length,
      0,
    );
  } finally {
    await act(async () => renderer?.unmount());
  }
});
