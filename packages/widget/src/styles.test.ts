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
  assert.match(styles, /outline: var\(--pal-effective-focus-width\)/);
  assert.match(styles, /data-pal-motion="reduced"/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.pal-spinner,[\s\S]*\.pal-celebration[\s\S]*animation: none/);
  assert.match(
    styles,
    /data-pal-motion="reduced"[\s\S]*\.pal-celebration-fireworks span[\s\S]*animation: none/,
  );
  assert.match(
    styles,
    /data-pal-motion="reduced"[\s\S]*\.pal-celebration-fireworks::before[\s\S]*animation: none/,
  );
  assert.match(
    styles,
    /data-pal-motion="reduced"[\s\S]*data-pal-effect="fireworks"\]::before[\s\S]*animation: none/,
  );
});

test("modal backdrop fills its containing block", () => {
  const backdropRule =
    styles.match(/\.pal-celebration-backdrop \{([^}]+)\}/)?.[1] ?? "";
  assert.match(backdropRule, /position: absolute/);
  assert.match(backdropRule, /inset: 0/);
});

test("fireworks can travel beyond the celebration card", () => {
  const fireworksRule =
    styles.match(/\.pal-celebration\[data-pal-effect="fireworks"\] \{([^}]+)\}/)?.[1] ?? "";
  assert.match(fireworksRule, /overflow: visible/);
  assert.match(styles, /--pal-firework-distance: 19rem/);
  assert.match(styles, /@keyframes pal-level-up-brightness/);
});

test("responsive behavior follows the host viewport contract", () => {
  assert.match(styles, /data-pal-viewport="narrow"/);
  assert.match(
    styles,
    /\.pal-surface\.pal-achievements\[data-pal-viewport="narrow"\]/,
  );
  const narrowTooltipRule =
    styles.match(
      /\.pal-surface\[data-pal-viewport="narrow"\] \.pal-badge-tooltip \{([^}]+)\}/,
    )?.[1] ?? "";
  assert.match(narrowTooltipRule, /right: 0/);
  assert.match(narrowTooltipRule, /left: auto/);
  assert.match(styles, /data-week-status="current"[\s\S]*transform: scale\(1\.1\)/);
  const narrowStoryRule =
    styles.match(
      /\.pal-surface\[data-pal-viewport="narrow"\] \.pal-week-story \{([^}]+)\}/,
    )?.[1] ?? "";
  const narrowWeekContentRule =
    styles.match(
      /\.pal-surface\[data-pal-viewport="narrow"\] \.pal-week-content \{([^}]+)\}/,
    )?.[1] ?? "";
  assert.match(narrowStoryRule, /grid-column: 1 \/ -1/);
  assert.match(narrowStoryRule, /grid-row: 1/);
  assert.match(narrowStoryRule, /text-align: center/);
  assert.match(narrowWeekContentRule, /grid-column: 1 \/ -1/);
  assert.match(narrowWeekContentRule, /margin-top: 0/);
  assert.match(narrowWeekContentRule, /justify-content: center/);
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

test("roadmap muted text preserves contrast in both themes", () => {
  assert.doesNotMatch(styles, /data-week-status="future"/);
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

test("roadmap centers the collectible branch and keeps badges to its right", () => {
  const weekRule = styles.match(/\n\.pal-week \{([^}]+)\}/)?.[1] ?? "";
  const collectibleStackRule =
    styles.match(/\.pal-week-collectible-stack \{([^}]+)\}/)?.[1] ?? "";
  const collectibleLabelRule =
    styles.match(/\.pal-week-collectible strong \{([^}]+)\}/)?.[1] ?? "";
  const storyRule =
    styles.match(/\n\.pal-week-story \{([^}]+)\}/)?.[1] ?? "";
  const weekContentRule =
    styles.match(/\.pal-week-content \{([^}]+)\}/)?.[1] ?? "";

  assert.doesNotMatch(styles, /\.pal-week:not\(:last-child\)::before/);
  assert.match(
    weekRule,
    /grid-template-columns: minmax\(0, 1fr\) 5\.65rem minmax\(0, 1fr\)/,
  );
  assert.match(collectibleStackRule, /grid-column: 2/);
  assert.match(collectibleStackRule, /align-content: start/);
  assert.match(collectibleStackRule, /align-self: start/);
  assert.match(collectibleLabelRule, /-webkit-line-clamp: 2/);
  assert.match(collectibleLabelRule, /white-space: normal/);
  assert.doesNotMatch(
    styles,
    /\.pal-week-story[^{]*\{[^}]*border-left/,
  );
  assert.match(storyRule, /text-align: right/);
  assert.match(weekContentRule, /grid-column: 3/);
  assert.match(weekContentRule, /align-self: start/);
});

test("roadmap gives the current week a larger focal treatment without scroll trapping", () => {
  const roadmapRule = styles.match(/\.pal-roadmap-list \{([^}]+)\}/)?.[1] ?? "";
  const currentStackRule =
    styles.match(
      /\.pal-week\[data-week-status="current"\] \.pal-week-collectible-stack \{([^}]+)\}/,
    )?.[1] ?? "";
  const achievementsRule =
    styles.match(/\.pal-achievements \{([^}]+)\}/)?.[1] ?? "";
  const narrowRoadmapRule =
    styles.match(
      /\.pal-surface\[data-pal-viewport="narrow"\] \.pal-roadmap-list \{([^}]+)\}/,
    )?.[1] ?? "";

  assert.match(
    roadmapRule,
    /padding-block-start: 7rem/,
  );
  assert.match(
    roadmapRule,
    /padding-block-end: 7rem/,
  );
  assert.doesNotMatch(roadmapRule, /28rem/);
  assert.match(
    narrowRoadmapRule,
    /padding-block-end: 5rem/,
  );
  assert.doesNotMatch(roadmapRule, /vh/);
  assert.doesNotMatch(narrowRoadmapRule, /vh/);
  assert.doesNotMatch(narrowRoadmapRule, /34rem/);
  assert.match(currentStackRule, /transform: scale\(1\.18\)/);
  assert.doesNotMatch(roadmapRule, /scroll-snap/);
  assert.doesNotMatch(achievementsRule, /overflow:/);
});

test("badge tooltips stay hoverable while the pointer enters the disclosure", () => {
  const tooltipRule =
    styles.match(/\.pal-badge-tooltip \{([^}]+)\}/)?.[1] ?? "";
  const tooltipBridgeRule =
    styles.match(/\.pal-badge-tooltip::after \{([^}]+)\}/)?.[1] ?? "";
  const visibleTooltipRule =
    styles.match(
      /\.pal-badge-control:hover \.pal-badge-tooltip,[\s\S]*?\.pal-badge-control:focus-visible \.pal-badge-tooltip \{([^}]+)\}/,
    )?.[1] ?? "";

  assert.match(tooltipRule, /visibility: hidden/);
  assert.match(tooltipRule, /pointer-events: none/);
  assert.match(tooltipBridgeRule, /top: 100%/);
  assert.match(tooltipBridgeRule, /height: 0\.6rem/);
  assert.match(visibleTooltipRule, /visibility: visible/);
  assert.match(visibleTooltipRule, /pointer-events: auto/);
});

test("badges share one circular footprint and keep a minimum 44px target", () => {
  const badgeControlRule =
    styles.match(/\.pal-badge-control \{([^}]+)\}/)?.[1] ?? "";
  const progressRingRule =
    styles.match(/\.pal-badge-progress-ring \{([^}]+)\}/)?.[1] ?? "";
  const narrowBadgeRules = [
    ...styles.matchAll(
      /\.pal-surface\[data-pal-viewport="narrow"\] \.pal-badge \{([^}]+)\}/g,
    ),
  ];

  assert.match(
    badgeControlRule,
    /min-width: var\(--pal-effective-control-min\)/,
  );
  assert.match(
    badgeControlRule,
    /min-height: var\(--pal-effective-control-min\)/,
  );
  assert.match(badgeControlRule, /width: 4\.5rem/);
  assert.match(badgeControlRule, /height: 4\.5rem/);
  assert.match(progressRingRule, /width: 100%/);
  assert.match(progressRingRule, /height: 100%/);
  assert.equal(narrowBadgeRules.length, 1);
  assert.match(narrowBadgeRules[0]?.[1] ?? "", /width: 3\.5rem/);
  assert.match(narrowBadgeRules[0]?.[1] ?? "", /height: 3\.5rem/);
});
