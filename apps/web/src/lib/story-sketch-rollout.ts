const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

export function parseStorySketchRewardsEffectiveAt(
  raw: string | undefined,
): Date | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) {
    throw new Error(
      "PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT must be an RFC 3339 timestamp with Z or an explicit offset",
    );
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, "0"));
  const localUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const local = new Date(localUtc);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    throw new Error("PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT is not a real calendar instant");
  }
  if (zone === "Z") return local;
  const offsetHours = Number(zone.slice(1, 3));
  const offsetMinutes = Number(zone.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) {
    throw new Error("PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT has an invalid UTC offset");
  }
  const direction = zone[0] === "+" ? 1 : -1;
  return new Date(localUtc - direction * (offsetHours * 60 + offsetMinutes) * 60_000);
}

// Parsed once when the server worker starts. Invalid deployment configuration
// fails before an event transaction opens; an unset value disables the rollout.
export const STORY_SKETCH_REWARDS_EFFECTIVE_AT =
  parseStorySketchRewardsEffectiveAt(
    process.env.PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT,
  );
