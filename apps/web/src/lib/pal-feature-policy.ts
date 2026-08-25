import type { PalFeaturePolicy } from "@codepet/pal-widget";
import { DEFAULT_PAL_FEATURE_POLICY } from "@codepet/pal-widget/feature-policy";

const TITLES_VISIBLE_ENV = "PAL_ACHIEVEMENT_TITLES_VISIBLE";

interface PalFeaturePolicyEnvironment {
  [key: string]: string | undefined;
  PAL_ACHIEVEMENT_TITLES_VISIBLE?: string;
}

/** Resolves deploy-time configuration once at the authenticated snapshot boundary. */
export function resolvePalFeaturePolicy(
  environment: PalFeaturePolicyEnvironment = process.env,
): PalFeaturePolicy {
  const titlesVisible = environment.PAL_ACHIEVEMENT_TITLES_VISIBLE;
  const normalized = titlesVisible?.trim().toLowerCase();
  if (normalized === undefined || normalized === "") {
    return DEFAULT_PAL_FEATURE_POLICY;
  }
  if (normalized !== "true" && normalized !== "false") {
    throw new Error(`${TITLES_VISIBLE_ENV} must be true or false`);
  }
  return {
    achievements: {
      titles: normalized === "true",
    },
  };
}
