import assert from "node:assert/strict";
import test from "node:test";
import { act, create } from "react-test-renderer";

import { PalCompanion } from "./companion";
import { createFixtureSnapshot } from "./fixture-client";
import { PalProvider } from "./provider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

test("a missing mood frame falls back to the supplied rest image", async () => {
  const originalWindow = globalThis.window;
  let renderer: ReturnType<typeof create> | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    },
  });

  try {
    const snapshot = createFixtureSnapshot(5);
    snapshot.companion.mood = "happy";
    snapshot.progression!.companionReveal = {
      status: "earned",
      assetUrl: "/only/rest.png",
    };

    await act(async () => {
      renderer = create(
        <PalProvider
          client={{
            getSnapshot: async () => snapshot,
            markRewardSeen: async () => undefined,
          }}
          initialSnapshot={snapshot}
          motion="reduced"
          scopeKey="missing-sprites"
        >
          <PalCompanion />
        </PalProvider>,
      );
    });

    const images = renderer!.root.findAll(
      (node) => node.type === "img" && node.props.className === "pal-companion-sprite",
    );
    const rest = images.find((image) => image.props.src === "/only/rest.png")!;
    const missing = images.find(
      (image) => image.props.src === "/only/happy-1.png",
    )!;
    assert.equal(images.length, 2);
    assert.equal(missing.props.style.opacity, 0);
    assert.equal(rest.props.style.opacity, 1);

    await act(async () => {
      missing.props.onError();
    });
    assert.equal(
      renderer!.root.findAllByType("img").find(
        (image) => image.props.src === "/only/rest.png",
      )!.props.style.opacity,
      1,
    );
  } finally {
    await act(async () => renderer?.unmount());
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("the companion mounts only frames used by the current mood", async () => {
  const originalWindow = globalThis.window;
  let renderer: ReturnType<typeof create> | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    },
  });

  try {
    const snapshot = createFixtureSnapshot(5);
    snapshot.companion.mood = "happy";
    snapshot.progression!.companionReveal = {
      status: "earned",
      assetUrl: "/pets/rest.png",
    };

    await act(async () => {
      renderer = create(
        <PalProvider
          client={{
            getSnapshot: async () => snapshot,
            markRewardSeen: async () => undefined,
          }}
          initialSnapshot={snapshot}
          motion="system"
          scopeKey="current-mood-sprites"
        >
          <PalCompanion />
        </PalProvider>,
      );
    });

    const sources = renderer!.root
      .findAll(
        (node) => node.type === "img" && node.props.className === "pal-companion-sprite",
      )
      .map((image) => image.props.src);
    assert.deepEqual(sources, [
      "/pets/rest.png",
      "/pets/happy-1.png",
      "/pets/happy-2.png",
    ]);

    const happy = renderer!.root
      .findAllByType("img")
      .find((image) => image.props.src === "/pets/happy-1.png")!;
    await act(async () => happy.props.onLoad());
    assert.equal(happy.props.style.opacity, 1);
    assert.equal(
      renderer!.root.findAllByType("img").find(
        (image) => image.props.src === "/pets/rest.png",
      )!.props.style.opacity,
      0,
    );
  } finally {
    await act(async () => renderer?.unmount());
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("a non-Pip companion never borrows Pip's animation set", async () => {
  const originalWindow = globalThis.window;
  let renderer: ReturnType<typeof create> | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    },
  });

  try {
    const snapshot = createFixtureSnapshot(5);
    snapshot.companion.mood = "happy";
    snapshot.progression!.companionReveal = {
      status: "earned",
      assetUrl: "/assets/pets/lumi-v1.png",
    };

    await act(async () => {
      renderer = create(
        <PalProvider
          client={{
            getSnapshot: async () => snapshot,
            markRewardSeen: async () => undefined,
          }}
          initialSnapshot={snapshot}
          motion="system"
          scopeKey="named-static-companion"
        >
          <PalCompanion />
        </PalProvider>,
      );
    });

    const sources = renderer!.root
      .findAll(
        (node) => node.type === "img" && node.props.className === "pal-companion-sprite",
      )
      .map((image) => image.props.src);
    assert.deepEqual(sources, ["/assets/pets/lumi-v1.png"]);
  } finally {
    await act(async () => renderer?.unmount());
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("the young Pip collectible uses Pip's animated widget presentation", async () => {
  const originalWindow = globalThis.window;
  let renderer: ReturnType<typeof create> | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    },
  });

  try {
    const snapshot = createFixtureSnapshot(5);
    snapshot.companion.mood = "happy";
    snapshot.progression!.companionReveal = {
      status: "earned",
      assetUrl:
        "https://pal.example/assets/pets/young-pip-v1.png?credential=key/20260825/region",
    };

    await act(async () => {
      renderer = create(
        <PalProvider
          client={{
            getSnapshot: async () => snapshot,
            markRewardSeen: async () => undefined,
          }}
          initialSnapshot={snapshot}
          motion="system"
          scopeKey="animated-young-pip"
        >
          <PalCompanion />
        </PalProvider>,
      );
    });

    const sources = renderer!.root
      .findAll(
        (node) => node.type === "img" && node.props.className === "pal-companion-sprite",
      )
      .map((image) => image.props.src);
    assert.deepEqual(sources, [
      "https://pal.example/assets/pets/default.png?credential=key/20260825/region",
      "https://pal.example/assets/pets/happy-1.png",
      "https://pal.example/assets/pets/happy-2.png",
    ]);
  } finally {
    await act(async () => renderer?.unmount());
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
