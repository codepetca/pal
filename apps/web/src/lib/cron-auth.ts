import { createHash, timingSafeEqual } from "node:crypto";

const CRON_SECRET = /^[A-Za-z0-9_-]{32,256}$/;

export type CronAuthorization =
  | "authorized"
  | "unauthorized"
  | "configuration_error";

export function authorizeCronRequest(
  authorizationHeader: string | null,
  configuredSecret: string | undefined,
): CronAuthorization {
  if (!configuredSecret || !CRON_SECRET.test(configuredSecret)) {
    return "configuration_error";
  }
  if (!authorizationHeader) return "unauthorized";
  const expected = `Bearer ${configuredSecret}`;
  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(authorizationHeader), digest(expected))
    ? "authorized"
    : "unauthorized";
}
