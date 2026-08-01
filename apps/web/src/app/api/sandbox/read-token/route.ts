import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@pal/db";
import { getOrCreateLearnerIdentity } from "@/lib/db-learner";
import { resolveSandboxIntegration } from "@/lib/integration-auth";
import { mintPalReadToken } from "@/lib/read-token";
import {
  isSandboxLearnerId,
  isSandboxRuntimeAllowed,
} from "@/lib/sandbox-learner";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Development/preview only. This mirrors a host backend exchanging its own
// authenticated learner identity for a short-lived Pal browser credential.
// The sandbox integration secret never leaves this server.
export async function POST(req: NextRequest) {
  if (!isSandboxRuntimeAllowed()) {
    return noStore({ error: "not_found" }, 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: "invalid_request" }, 400);
  }
  const learnerId =
    typeof body === "object" && body !== null && "learner_id" in body
      ? body.learner_id
      : undefined;
  if (!isSandboxLearnerId(learnerId)) {
    return noStore({ error: "invalid_sandbox_learner_id" }, 422);
  }

  const integration = await resolveSandboxIntegration();
  const internalLearnerId = await getOrCreateLearnerIdentity(
    getDb(),
    integration.id,
    learnerId,
  );
  const { token, expiresAt } = await mintPalReadToken({
    learnerId: internalLearnerId,
    integrationId: integration.id,
  });
  return noStore({ token, expires_at: expiresAt.toISOString() });
}
