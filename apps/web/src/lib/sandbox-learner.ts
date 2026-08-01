const SANDBOX_LEARNER_ID =
  /^sandbox-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Sandbox state is isolated to an unguessable browser-session identifier. */
export function isSandboxLearnerId(value: unknown): value is string {
  return typeof value === "string" && SANDBOX_LEARNER_ID.test(value);
}

/** Sandbox mutation/read-token routes exist only in local and preview builds. */
export function isSandboxRuntimeAllowed(
  env: { NODE_ENV?: string; VERCEL_ENV?: string } = process.env,
): boolean {
  if (env.VERCEL_ENV) {
    return env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development";
  }
  return env.NODE_ENV !== "production";
}
