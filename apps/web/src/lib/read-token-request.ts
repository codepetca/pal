const URL_SAFE_TOKEN = /^[A-Za-z0-9._~-]+$/;

export type ReadTokenRequestValidation =
  | { ok: true; learnerId: string }
  | { ok: false; detail: string };

export function validateReadTokenRequest(
  value: unknown,
): ReadTokenRequestValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, detail: "request body must be an object" };
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "learner_id") {
    return {
      ok: false,
      detail: "request body must contain only learner_id",
    };
  }
  if (
    typeof body.learner_id !== "string" ||
    body.learner_id.length < 1 ||
    body.learner_id.length > 128 ||
    !URL_SAFE_TOKEN.test(body.learner_id)
  ) {
    return {
      ok: false,
      detail: "learner_id must be 1-128 URL-safe characters",
    };
  }
  return { ok: true, learnerId: body.learner_id };
}
