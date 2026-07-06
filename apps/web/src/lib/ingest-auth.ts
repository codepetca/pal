import { timingSafeEqual } from "node:crypto";

// Checks an Authorization header against the integration secret.
// M1: one shared secret from the environment. Post-M1 this becomes a
// lookup in the integrations table (each integration owns its secret).
export function isAuthorizedIngest(authHeader: string | null): boolean {
  const secret = process.env.SANDBOX_INTEGRATION_SECRET;
  if (!secret) return false; // unconfigured server accepts nothing

  if (!authHeader?.startsWith("Bearer ")) return false;
  const presented = authHeader.slice("Bearer ".length);

  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  // timingSafeEqual requires equal lengths; length mismatch is a mismatch
  return a.length === b.length && timingSafeEqual(a, b);
}
