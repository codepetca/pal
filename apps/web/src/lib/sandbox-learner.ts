const SANDBOX_LEARNER_ID =
  /^sandbox-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Sandbox state is isolated to an unguessable browser-session identifier. */
export function isSandboxLearnerId(value: unknown): value is string {
  return typeof value === "string" && SANDBOX_LEARNER_ID.test(value);
}

type SandboxEnvironment = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
};

/** The fixture-only sandbox page is public in previews and available locally. */
export function isSandboxPageAllowed(
  env: SandboxEnvironment = process.env,
): boolean {
  if (env.VERCEL_ENV) {
    return env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development";
  }
  return env.NODE_ENV !== "production";
}

/** Persisted sandbox APIs are a local integration-debugging tool only. */
export function isPersistedSandboxRuntimeAllowed(
  env: {
    NODE_ENV?: string;
    VERCEL_ENV?: string;
  } = process.env,
): boolean {
  if (env.VERCEL_ENV) {
    return env.VERCEL_ENV === "development";
  }
  return env.NODE_ENV !== "production";
}
