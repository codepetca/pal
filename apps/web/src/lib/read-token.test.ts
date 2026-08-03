import assert from "node:assert/strict";
import test from "node:test";
import { decodeJwt, SignJWT } from "jose";
import {
  InvalidReadTokenError,
  PAL_READ_TOKEN_AUDIENCE,
  PAL_READ_TOKEN_ISSUER,
  PAL_READ_TOKEN_TTL_SECONDS,
  mintPalReadToken,
  verifyPalReadToken,
} from "./read-token";

const signingSecret = "test-only-pal-read-token-signing-secret-32-plus";
process.env.PAL_READ_TOKEN_SIGNING_SECRET = signingSecret;

const learnerId = "00000000-0000-4000-8000-000000000001";
const integrationId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-01T12:00:00.000Z");

test("mints a short-lived learner-scoped token without the external learner token", async () => {
  const externalLearnerToken = "pika-learner-do-not-expose";
  const result = await mintPalReadToken({ learnerId, integrationId, now });
  const payload = decodeJwt(result.token);

  assert.equal(payload.sub, learnerId);
  assert.equal(payload.integration_id, integrationId);
  assert.equal(payload.iss, "pal");
  assert.equal(payload.aud, "pal-widget");
  assert.equal(payload.scope, "learner:read reward:ack");
  assert.equal(payload.exp! - payload.iat!, PAL_READ_TOKEN_TTL_SECONDS);
  assert.equal(result.token.includes(externalLearnerToken), false);

  const verified = await verifyPalReadToken(
    result.token,
    "learner:read",
    now,
  );
  assert.equal(verified.learnerId, learnerId);
  assert.equal(verified.integrationId, integrationId);
  assert.equal(verified.scopes.has("reward:ack"), true);
});

test("rejects altered and expired tokens", async () => {
  const result = await mintPalReadToken({ learnerId, integrationId, now });
  const [header, payload, signature] = result.token.split(".");
  const alteredPayload = `${payload[0] === "a" ? "b" : "a"}${payload.slice(1)}`;
  const altered = [header, alteredPayload, signature].join(".");

  await assert.rejects(
    verifyPalReadToken(altered, "learner:read", now),
    InvalidReadTokenError,
  );
  await assert.rejects(
    verifyPalReadToken(
      result.token,
      "learner:read",
      new Date(now.getTime() + (PAL_READ_TOKEN_TTL_SECONDS + 31) * 1_000),
    ),
    InvalidReadTokenError,
  );
});

async function signClaims(input: {
  issuedAt?: number;
  expiresAt: number;
}) {
  let token = new SignJWT({
    integration_id: integrationId,
    scope: "learner:read reward:ack",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(PAL_READ_TOKEN_ISSUER)
    .setAudience(PAL_READ_TOKEN_AUDIENCE)
    .setSubject(learnerId)
    .setJti("00000000-0000-4000-8000-000000000003");
  if (input.issuedAt !== undefined) token = token.setIssuedAt(input.issuedAt);
  return token
    .setExpirationTime(input.expiresAt)
    .sign(new TextEncoder().encode(signingSecret));
}

test("rejects missing, future, and overlong issuance windows", async () => {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const tokens = [
    await signClaims({
      expiresAt: issuedAt + PAL_READ_TOKEN_TTL_SECONDS,
    }),
    await signClaims({
      issuedAt: issuedAt + 31,
      expiresAt: issuedAt + 31 + PAL_READ_TOKEN_TTL_SECONDS,
    }),
    await signClaims({
      issuedAt,
      expiresAt: issuedAt + PAL_READ_TOKEN_TTL_SECONDS + 1,
    }),
  ];

  for (const token of tokens) {
    await assert.rejects(
      verifyPalReadToken(token, "learner:read", now),
      InvalidReadTokenError,
    );
  }
});

test("rejects signing-key reuse across trust boundaries", async () => {
  const originalPikaSecret = process.env.PAL_INTEGRATION_SECRET;
  const originalSandboxSecret = process.env.SANDBOX_INTEGRATION_SECRET;
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  try {
    for (const envName of [
      "PAL_INTEGRATION_SECRET",
      "SANDBOX_INTEGRATION_SECRET",
    ] as const) {
      process.env.PAL_INTEGRATION_SECRET = originalPikaSecret;
      process.env.SANDBOX_INTEGRATION_SECRET = originalSandboxSecret;
      process.env[envName] = signingSecret;
      await assert.rejects(
        mintPalReadToken({ learnerId, integrationId, now }),
        new RegExp(`distinct from ${envName}`),
      );
    }
  } finally {
    restore("PAL_INTEGRATION_SECRET", originalPikaSecret);
    restore("SANDBOX_INTEGRATION_SECRET", originalSandboxSecret);
  }
});

test("rejects a token that lacks the required scope", async () => {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const token = await new SignJWT({
    integration_id: integrationId,
    scope: "learner:read",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(PAL_READ_TOKEN_ISSUER)
    .setAudience(PAL_READ_TOKEN_AUDIENCE)
    .setSubject(learnerId)
    .setJti("00000000-0000-4000-8000-000000000003")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + PAL_READ_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(signingSecret));

  await assert.rejects(
    verifyPalReadToken(token, "reward:ack", now),
    InvalidReadTokenError,
  );
});
