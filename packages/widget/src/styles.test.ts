import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PAL_THEME_PROPERTIES } from "./theme-contract";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return (
      channels[0]! * 0.2126 +
      channels[1]! * 0.7152 +
      channels[2]! * 0.0722
    );
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function hexFallbacks(variable: string): string[] {
  return [
    ...styles.matchAll(
      new RegExp(
        `${variable}: var\\([^,]+, (#[0-9a-f]{6})\\)`,
        "g",
      ),
    ),
  ].map((match) => match[1]!);
}

function hexAssignments(variable: string): string[] {
  return [
    ...styles.matchAll(
      new RegExp(`${variable}: (#[0-9a-f]{6})`, "g"),
    ),
  ].map((match) => match[1]!);
}

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
  const narrowHeaderRule =
    styles.match(
      /data-pal-viewport="narrow"\] \.pal-roadmap-header \{([^}]+)\}/,
    )?.[1] ?? "";
  assert.match(narrowHeaderRule, /flex-wrap: wrap/);
  const narrowDateRule =
    styles.match(
      /data-pal-viewport="narrow"\] \.pal-week-date \{([^}]+)\}/,
    )?.[1] ?? "";
  assert.match(narrowDateRule, /grid-column: 2/);
  assert.doesNotMatch(narrowDateRule, /display:\s*none/);
});

test("companion owns its portable visual composition without placement", () => {
  assert.match(styles, /\.pal-companion-grass/);
  assert.match(styles, /--pal-companion-cat-height/);

  const companionRule =
    styles.match(/\n\.pal-companion \{([^}]+)\}/)?.[1] ?? "";
  assert.match(companionRule, /position: relative/);
  assert.doesNotMatch(companionRule, /position: (fixed|absolute|sticky)/);
  assert.doesNotMatch(companionRule, /(^|\n)\s*(top|right|bottom|left):/);
});

test("future-week treatment preserves muted-text contrast in both themes", () => {
  const futureCardRule =
    styles.match(
      /\.pal-week\[data-week-status="future"\] \.pal-week-card \{([^}]+)\}/,
    )?.[1] ?? "";
  assert.doesNotMatch(futureCardRule, /opacity/);
  assert.match(futureCardRule, /border-style: dashed/);

  const textFallbacks = hexFallbacks("--pal-effective-color-text-muted");
  const surfaceFallbacks = hexFallbacks("--pal-effective-color-surface");
  assert.equal(textFallbacks.length, 2);
  assert.equal(surfaceFallbacks.length, 2);
  for (const themeIndex of [0, 1]) {
    assert.ok(
      contrastRatio(
        textFallbacks[themeIndex]!,
        surfaceFallbacks[themeIndex]!,
      ) >= 4.5,
    );
  }
});

test("status-filled roadmap nodes preserve text contrast in both themes", () => {
  const successFills = hexFallbacks("--pal-effective-color-success");
  const successText = hexAssignments("--pal-effective-color-on-success");
  const warningFills = hexFallbacks("--pal-effective-color-warning");
  const warningText = hexAssignments("--pal-effective-color-on-warning");

  assert.equal(successFills.length, 2);
  assert.equal(successText.length, 2);
  assert.equal(warningFills.length, 2);
  assert.equal(warningText.length, 2);

  for (const themeIndex of [0, 1]) {
    assert.ok(
      contrastRatio(successText[themeIndex]!, successFills[themeIndex]!) >= 4.5,
    );
    assert.ok(
      contrastRatio(warningText[themeIndex]!, warningFills[themeIndex]!) >= 4.5,
    );
  }
});
