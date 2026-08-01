const SANDBOX_LEARNER_ID =
  /^sandbox-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Sandbox state is isolated to an unguessable browser-session identifier. */
export function isSandboxLearnerId(value: unknown): value is string {
  return typeof value === "string" && SANDBOX_LEARNER_ID.test(value);
}

/** Sandbox routes run locally, or in an explicitly protected preview; never production. */
export function isSandboxRuntimeAllowed(
  env: {
    NODE_ENV?: string;
    VERCEL_ENV?: string;
    PAL_SANDBOX_PROTECTED_PREVIEW?: string;
  } = process.env,
): boolean {
  if (env.VERCEL_ENV) {
    if (env.VERCEL_ENV === "preview") {
      return env.PAL_SANDBOX_PROTECTED_PREVIEW === "true";
    }
    return env.VERCEL_ENV === "development";
  }
  return env.NODE_ENV !== "production";
}
