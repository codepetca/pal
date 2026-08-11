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
  assert.match(styles, /\.pal-history-toggle:focus-visible/);
  assert.match(styles, /\.pal-history-week-toggle:focus-visible/);
  assert.match(styles, /outline: var\(--pal-effective-focus-width\)/);
  assert.match(styles, /data-pal-motion="reduced"/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.pal-spinner,[\s\S]*\.pal-celebration[\s\S]*animation: none/);

  // Every animation this surface adds has to be answerable by both motion
  // switches, the OS preference and the host's explicit setting.
  for (const animated of [
    "\\.pal-rise",
    "\\.pal-bar-fill",
    '\\[data-achievement-status="earned"\\] \\.pal-badge',
  ]) {
    const mediaBlock =
      styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    assert.match(mediaBlock, new RegExp(animated));
    assert.match(
      styles,
      new RegExp(`\\.pal-surface\\[data-pal-motion="reduced"\\] ${animated}`),
    );
  }
});

test("responsive behavior follows the host viewport contract", () => {
  assert.match(styles, /data-pal-viewport="narrow"/);
  assert.doesNotMatch(styles, /@media\s*\(\s*max-width/);
});

test("companion owns its portable visual composition without placement", () => {
  assert.doesNotMatch(styles, /grass/);
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
      /\.pal-week-card\[data-week-status="future"\] \{([^}]+)\}/,
    )?.[1] ?? "";
  assert.doesNotMatch(futureCardRule, /opacity/);
  assert.match(futureCardRule, /border-style: dashed/);

  const nextWeekRule = styles.match(/\.pal-week-next \{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(nextWeekRule, /opacity/);
  assert.match(nextWeekRule, /background: var\(--pal-effective-color-surface-muted\)/);

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
