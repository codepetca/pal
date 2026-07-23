// Event types an integration is allowed to send. Per docs/integration.md this is the
// set Pika sends; it becomes a per-integration allow-list column in M1.
const ALLOWED_INGEST_EVENT_TYPES = new Set([
  "platform.session.started",
  "classroom.joined",
  "daily_log_week.configured",
  "daily_log.completed",
  "learning_item.viewed",
  "learning_item.completed",
]);

// Derived events (XP_CHANGED, LEVEL_UP, STREAK_MILESTONE) are produced by mutation
// handlers inside the cascade and are never accepted on the ingest API — otherwise an
// integration could POST LEVEL_UP and hand itself a level, or drive the economy
// directly. The allow-list already excludes them; this is the belt to that braces.
export function isIngestableEventType(eventType: string): boolean {
  if (!ALLOWED_INGEST_EVENT_TYPES.has(eventType)) return false;
  return eventType === eventType.toLowerCase();
}
