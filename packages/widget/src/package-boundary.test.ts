import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sandboxSource = readFileSync(
  new URL(
    "../../../apps/web/src/app/sandbox/WidgetSandbox.tsx",
    import.meta.url,
  ),
  "utf8",
);
const sandboxStyles = readFileSync(
  new URL(
    "../../../apps/web/src/app/sandbox/widget-sandbox.module.css",
    import.meta.url,
  ),
  "utf8",
);
const engineClientSource = readFileSync(
  new URL(
    "../../../apps/web/src/app/sandbox/engine-pal-client.ts",
    import.meta.url,
  ),
  "utf8",
);

test("sandbox consumes only the widget public package boundary", () => {
  for (const source of [sandboxSource, engineClientSource]) {
    assert.match(source, /from "@pal\/widget"/);
    assert.doesNotMatch(source, /packages\/widget\/src/);
    assert.doesNotMatch(source, /@pal\/widget\//);
  }
});

test("sandbox says which surfaces are engine-backed and which are fixtures", () => {
  assert.match(sandboxSource, /Fixture preview/);
  assert.match(sandboxSource, /no production state is connected/);
  // The companion is read back from the rule engine; the roadmap and rewards
  // are still fixture state. Overclaiming either way misleads whoever is
  // demoing, so the copy has to keep drawing the line.
  assert.match(sandboxSource, /pet runs on the real engine/);
  assert.match(sandboxSource, /roadmap and rewards stay fixtures/);
  assert.match(sandboxSource, /createEnginePalClient/);
});

test("only the engine decides the companion's mood", () => {
  // The client reports what the world endpoint returns. If it ever starts
  // choosing a mood itself, the engine has stopped being the only thing that
  // moves learner state.
  assert.match(engineClientSource, /api\/v1\/world/);
  assert.doesNotMatch(engineClientSource, /mood = "(happy|excited|sleeping)"/);
});

test("sandbox reset rotates provider identity and controls start collapsed", () => {
  assert.match(sandboxSource, /useState\(true\)/);
  assert.match(sandboxSource, /fixture-learner-\$\{resetGeneration\}/);
  assert.match(sandboxSource, /key=\{fixtureScopeKey\}/);
  assert.match(sandboxSource, /setResetGeneration\(\(current\) => current \+ 1\)/);
});

test("sandbox navigation keeps accessible names when labels are visually hidden", () => {
  assert.match(sandboxSource, /aria-label=\{label\}/);
});

test("sandbox modal host makes application siblings inert and intercepts its backdrop", () => {
  assert.match(sandboxSource, /inert=\{celebrationOpen \|\| undefined\}/);
  assert.match(sandboxSource, /<PalRewardCelebration[\s\S]*modal/);
  assert.match(sandboxSource, /onOpenChange=\{setCelebrationOpen\}/);
  assert.match(
    sandboxStyles,
    /\.celebrationLayer \{[\s\S]*pointer-events: auto/,
  );
  assert.match(
    sandboxStyles,
    /\.celebrationLayer\[data-open="false"\] \{[\s\S]*pointer-events: none/,
  );
  assert.match(
    sandboxStyles,
    /\.celebrationLayer\[data-open="true"\] \{[\s\S]*background:/,
  );
  const baseLayerRule =
    sandboxStyles.match(/\.celebrationLayer \{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(baseLayerRule, /background:/);
});
