export const PAL_BEHAVIOR_TITLE_IDS = Object.freeze({
  rhythmBuilder: "rhythm-builder",
  onTimePro: "on-time-pro",
  levelLeader: "level-leader",
} as const);

export const RESERVED_BEHAVIOR_TITLE_IDS: ReadonlySet<string> = new Set(
  Object.values(PAL_BEHAVIOR_TITLE_IDS),
);
