import assert from "node:assert/strict";
import test from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PalAchievements } from "./achievements";
import { createFixturePalClient } from "./fixture-client";
import { PalProvider } from "./provider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

test("collapsed achievement history is inert until each drawer opens", async () => {
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
    const historyBodies = () =>
      renderer!.root.findAll(
        (node) =>
          node.type === "div" && node.props.className === "pal-history-body",
      );
    const historyToggle = renderer!.root.find(
      (node) =>
        node.type === "button" &&
        node.props.className === "pal-history-toggle pal-press",
    );

    assert.equal(historyBodies()[0]!.props.inert, true);
    assert.ok(historyBodies().slice(1).every((body) => body.props.inert === true));

    await act(async () => historyToggle.props.onClick());
    assert.equal(historyBodies()[0]!.props.inert, undefined);
    assert.ok(historyBodies().slice(1).every((body) => body.props.inert === true));

    const firstWeekToggle = renderer!.root.findAll(
      (node) =>
        node.type === "button" &&
        node.props.className === "pal-history-week-toggle pal-press",
    )[0]!;
    await act(async () => firstWeekToggle.props.onClick());

    assert.equal(historyBodies()[1]!.props.inert, undefined);
    assert.ok(historyBodies().slice(2).every((body) => body.props.inert === true));
  } finally {
    await act(async () => renderer?.unmount());
  }
});
