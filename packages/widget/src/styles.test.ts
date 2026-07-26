import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("widget exposes portable theme fallbacks and dark mode", () => {
  assert.match(styles, /var\(--pal-color-surface, #ffffff\)/);
  assert.match(styles, /data-pal-theme="dark"/);
  assert.match(styles, /var\(--pal-color-surface, #111827\)/);
  assert.match(styles, /font: inherit/);
});

test("widget controls and motion meet the initial accessibility contract", () => {
  assert.match(styles, /\.pal-button[\s\S]*min-height: 44px/);
  assert.match(styles, /\.pal-button:focus-visible/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.pal-spinner,[\s\S]*\.pal-celebration[\s\S]*animation: none/);
});
