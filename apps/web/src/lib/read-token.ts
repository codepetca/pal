import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const PAL_READ_TOKEN_ISSUER = "pal";
export const PAL_READ_TOKEN_AUDIENCE = "pal-widget";
export const PAL_READ_TOKEN_TTL_SECONDS = 5 * 60;
export const PAL_READ_TOKEN_CLOCK_TOLERANCE_SECONDS = 30;

export type PalReadScope = "learner:read" | "reward:ack";

export interface PalReadTokenClaims {
  learnerId: string;
  integrationId: string;
  scopes: ReadonlySet<PalReadScope>;
  expiresAt: Date;
}

export class InvalidReadTokenError extends Error {
  constructor() {
    super("Invalid or expired Pal read token");
    this.name = "InvalidReadTokenError";
  }
}

function signingKey(): Uint8Array {
  const secret = process.env.PAL_READ_TOKEN_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "PAL_READ_TOKEN_SIGNING_SECRET must be configured with at least 32 characters",
    );
  }
  return new TextEncoder().encode(secret);
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export async function mintPalReadToken(input: {
  learnerId: string;
  integrationId: string;
  now?: Date;
}): Promise<{ token: string; expiresAt: Date }> {
  if (!uuid(input.learnerId) || !uuid(input.integrationId)) {
    throw new Error("Pal read tokens require internal UUID identities");
  }

  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const expiresAtSeconds = issuedAt + PAL_READ_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({
    integration_id: input.integrationId,
    scope: "learner:read reward:ack",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(PAL_READ_TOKEN_ISSUER)
    .setAudience(PAL_READ_TOKEN_AUDIENCE)
    .setSubject(input.learnerId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(signingKey());

  return {
    token,
    expiresAt: new Date(expiresAtSeconds * 1_000),
  };
}

export async function verifyPalReadToken(
  token: string,
  requiredScope: PalReadScope,
  now?: Date,
): Promise<PalReadTokenClaims> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, signingKey(), {
      algorithms: ["HS256"],
      issuer: PAL_READ_TOKEN_ISSUER,
      audience: PAL_READ_TOKEN_AUDIENCE,
      clockTolerance: PAL_READ_TOKEN_CLOCK_TOLERANCE_SECONDS,
      currentDate: now,
    });
    const integrationId = payload.integration_id;
    const scopes = new Set(
      typeof payload.scope === "string"
        ? payload.scope.split(" ").filter(Boolean)
        : [],
    );
    if (
      protectedHeader.typ !== "JWT" ||
      !uuid(payload.sub) ||
      !uuid(integrationId) ||
      typeof payload.exp !== "number" ||
      typeof payload.jti !== "string" ||
      !scopes.has(requiredScope)
    ) {
      throw new InvalidReadTokenError();
    }

    return {
      learnerId: payload.sub,
      integrationId,
      scopes: scopes as Set<PalReadScope>,
      expiresAt: new Date(payload.exp * 1_000),
    };
  } catch (error) {
    if (error instanceof InvalidReadTokenError) throw error;
    throw new InvalidReadTokenError();
  }
}

export function bearerToken(authorization: string | null): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
  return match && match[1].length <= 8_192 ? match[1] : null;
}
