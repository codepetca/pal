const SANDBOX_LEARNER_ID =
  /^sandbox-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Sandbox state is isolated to an unguessable browser-session identifier. */
export function isSandboxLearnerId(value: unknown): value is string {
  return typeof value === "string" && SANDBOX_LEARNER_ID.test(value);
}
