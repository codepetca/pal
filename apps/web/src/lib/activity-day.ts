const MINIMUM_IANA_OFFSET_MS = -12 * 60 * 60 * 1000;
const MAXIMUM_IANA_OFFSET_MS = 14 * 60 * 60 * 1000;

export function isPlausibleActivityDay(
  activityDay: string,
  occurredAtMs: number,
): boolean {
  const earliest = new Date(occurredAtMs + MINIMUM_IANA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  const latest = new Date(occurredAtMs + MAXIMUM_IANA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  return earliest <= activityDay && activityDay <= latest;
}
