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

test("sandbox consumes only the widget public package boundary", () => {
  assert.match(sandboxSource, /from "@pal\/widget"/);
  assert.doesNotMatch(sandboxSource, /packages\/widget\/src/);
  assert.doesNotMatch(sandboxSource, /@pal\/widget\//);
});

test("sandbox labels fixture mode as visual state rather than pipeline proof", () => {
  assert.match(sandboxSource, /Fixture preview/);
  assert.match(sandboxSource, /Visual states only/);
  assert.match(sandboxSource, /no production state is connected/);
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
});
