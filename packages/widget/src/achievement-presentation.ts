import type {
  PalAchievementKey,
  PalAchievementPresentation,
} from "./types";

export const PAL_ACHIEVEMENT_KEYS = Object.freeze({
  firstLogin: "first-pika-login",
  joinedClass: "joined-class",
  weeklyRhythm: "weekly-rhythm",
  readyEarly: "ready-early",
  onTimeFinish: "on-time-finish",
} as const satisfies Record<string, PalAchievementKey>);

const ACHIEVEMENT_PRESENTATIONS: Readonly<
  Record<PalAchievementKey, PalAchievementPresentation>
> = Object.freeze({
  [PAL_ACHIEVEMENT_KEYS.firstLogin]: Object.freeze({
    key: PAL_ACHIEVEMENT_KEYS.firstLogin,
    title: "First Pika Login",
    description: "Started your first authenticated Pika session.",
    badge: Object.freeze({
      label: "First Pika Login",
      assetUrl: "/assets/badges/badge-first-classroom-login-v1.png",
    }),
  }),
  [PAL_ACHIEVEMENT_KEYS.joinedClass]: Object.freeze({
    key: PAL_ACHIEVEMENT_KEYS.joinedClass,
    title: "Joined the Class",
    description: "Joined a new classroom.",
    badge: Object.freeze({
      label: "Joined the Class",
      assetUrl: "/assets/badges/badge-first-classroom-login-v1.png",
    }),
  }),
  [PAL_ACHIEVEMENT_KEYS.weeklyRhythm]: Object.freeze({
    key: PAL_ACHIEVEMENT_KEYS.weeklyRhythm,
    title: "Weekly Rhythm",
    description: "Complete daily logs on the target number of eligible days.",
    badge: Object.freeze({
      label: "Weekly Rhythm",
      assetUrl: "/assets/badges/badge-checkin-7-day-v1.png",
    }),
  }),
  [PAL_ACHIEVEMENT_KEYS.readyEarly]: Object.freeze({
    key: PAL_ACHIEVEMENT_KEYS.readyEarly,
    title: "Ready Early",
    description: "Opened a learning item soon after it was released.",
    badge: Object.freeze({
      label: "Ready Early",
      assetUrl: "/assets/badges/badge-ready-early-v1.png",
    }),
  }),
  [PAL_ACHIEVEMENT_KEYS.onTimeFinish]: Object.freeze({
    key: PAL_ACHIEVEMENT_KEYS.onTimeFinish,
    title: "On-Time Finish",
    description: "Completed a learning item by its deadline.",
    badge: Object.freeze({
      label: "On-Time Finish",
      assetUrl: "/assets/badges/badge-on-time-finish.png",
    }),
  }),
});

export function resolvePalAchievementPresentation(
  key: string,
): PalAchievementPresentation | undefined {
  if (!Object.prototype.hasOwnProperty.call(ACHIEVEMENT_PRESENTATIONS, key)) {
    return undefined;
  }
  const presentation = ACHIEVEMENT_PRESENTATIONS[key as PalAchievementKey];
  return presentation
    ? { ...presentation, badge: { ...presentation.badge } }
    : undefined;
}
