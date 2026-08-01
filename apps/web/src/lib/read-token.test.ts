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
  const altered = `${result.token.slice(0, -1)}${result.token.endsWith("a") ? "b" : "a"}`;

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
