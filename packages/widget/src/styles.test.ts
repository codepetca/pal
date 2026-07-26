import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PAL_THEME_PROPERTIES } from "./theme-contract";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("widget exposes portable theme fallbacks and dark mode", () => {
  assert.match(styles, /var\(--pal-color-surface, #ffffff\)/);
  assert.match(styles, /data-pal-theme="dark"/);
  assert.match(styles, /var\(--pal-color-surface, #111827\)/);
  assert.match(styles, /font: inherit/);
});

test("every public theme property is consumed and portable", () => {
  for (const property of PAL_THEME_PROPERTIES) {
    assert.match(
      styles,
      new RegExp(`var\\(\\s*${property.replaceAll("-", "\\-")},`),
    );
  }
});

test("widget controls and motion meet the accessibility contract", () => {
  assert.match(styles, /\.pal-button[\s\S]*min-height: var\(--pal-effective-control-min\)/);
  assert.match(styles, /\.pal-button:focus-visible/);
  assert.match(styles, /outline: var\(--pal-effective-focus-width\)/);
  assert.match(styles, /data-pal-motion="reduced"/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.pal-spinner,[\s\S]*\.pal-celebration[\s\S]*animation: none/);
});

test("responsive behavior follows the host viewport contract", () => {
  assert.match(styles, /data-pal-viewport="narrow"/);
  assert.doesNotMatch(styles, /@media\s*\(\s*max-width/);
});
