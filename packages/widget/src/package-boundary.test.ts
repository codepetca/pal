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
