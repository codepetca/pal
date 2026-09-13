export const canonicalUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const membershipReference = (value: unknown): value is string =>
  typeof value === "string" && /^pika-membership-v1-[0-9a-f]{32}$/.test(value);

export type ErasureRequest = { operation_id: string; learner_id: string };
export type ErasureReceipt = ErasureRequest & {
  schema_version: 1; status: "pending" | "completed";
  begun_at: string; completed_at: string | null;
};
function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function validErasureRequest(value: unknown): value is ErasureRequest {
  return exactKeys(value, ["operation_id", "learner_id"]) &&
    canonicalUuid(value.operation_id) && membershipReference(value.learner_id);
}
const utcTimestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function validErasureReceipt(value: unknown): value is ErasureReceipt {
  return exactKeys(value, ["schema_version", "operation_id", "learner_id", "status", "begun_at", "completed_at"]) &&
    value.schema_version === 1 && canonicalUuid(value.operation_id) && membershipReference(value.learner_id) &&
    utcTimestamp(value.begun_at) &&
    ((value.status === "pending" && value.completed_at === null) ||
      (value.status === "completed" && utcTimestamp(value.completed_at) && value.completed_at >= value.begun_at));
}

/** Explicit tenant UUID allowlist, absent/malformed = deny all. No wildcard. */
export function erasureEnabled(integrationId: string, configured = process.env.PAL_PROFILE_ERASURE_INTEGRATION_IDS): boolean {
  if (!configured) return false;
  const ids = configured.split(",").map(value => value.trim());
  return ids.every(canonicalUuid) && ids.includes(integrationId);
}
