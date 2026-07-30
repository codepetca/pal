export const PAL_THEME_CONTRACT_VERSION = 1 as const;

/**
 * The complete host-owned visual input boundary for @pal/widget.
 *
 * Every property is optional because the widget provides light and dark
 * fallbacks. Hosts should map semantic tokens rather than literal values.
 */
export const PAL_THEME_PROPERTIES = [
  "--pal-color-page",
  "--pal-color-surface",
  "--pal-color-surface-muted",
  "--pal-color-surface-selected",
  "--pal-color-border",
  "--pal-color-border-strong",
  "--pal-color-text",
  "--pal-color-text-muted",
  "--pal-color-text-inverse",
  "--pal-color-primary",
  "--pal-color-primary-solid",
  "--pal-color-primary-solid-hover",
  "--pal-color-success",
  "--pal-color-success-bg",
  "--pal-color-warning",
  "--pal-color-warning-bg",
  "--pal-font-family-ui",
  "--pal-radius-control",
  "--pal-radius-card",
  "--pal-shadow-panel",
  "--pal-focus-color",
  "--pal-focus-width",
  "--pal-focus-offset",
  "--pal-motion-duration-fast",
  "--pal-motion-duration-standard",
  "--pal-motion-duration-deliberate",
  "--pal-motion-easing-standard",
  "--pal-size-control-min",
  "--pal-space-card",
  "--pal-space-control",
  "--pal-density-compact-gutter",
  "--pal-density-compact-content-top",
  "--pal-density-compact-stack",
  "--pal-density-comfortable-gutter",
  "--pal-density-comfortable-content-top",
  "--pal-density-comfortable-stack",
] as const;

export type PalThemeProperty = (typeof PAL_THEME_PROPERTIES)[number];

export const PAL_THEME_ATTRIBUTES = {
  density: ["compact", "comfortable"],
  motion: ["system", "reduced"],
  theme: ["light", "dark"],
  viewport: ["narrow", "wide"],
} as const;
