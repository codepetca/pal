import { lifecycleTransaction, ProfileErasedError, isLifecycleLockFailure } from "@/lib/profile-lifecycle";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@pal/db";
import { provisionActiveLearner } from "@/lib/db-learner";
import { resolveSandboxIntegration } from "@/lib/integration-auth";
import { mintPalReadToken } from "@/lib/read-token";
import {
  isSandboxLearnerId,
  isPersistedSandboxRuntimeAllowed,
} from "@/lib/sandbox-learner";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Local development only. This mirrors a host backend exchanging its own
// authenticated learner identity for a short-lived Pal browser credential.
// The sandbox integration secret never leaves this server.
export async function POST(req: NextRequest) {
  if (!isPersistedSandboxRuntimeAllowed()) {
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

  try {
    const integration = await resolveSandboxIntegration();
    const { token, expiresAt } = await lifecycleTransaction(getDb(), async (tx) => {
      const internalLearnerId = await provisionActiveLearner(
        tx,
        integration.id,
        learnerId,
      );
      return mintPalReadToken({
        learnerId: internalLearnerId,
        integrationId: integration.id,
      });
    });
    return noStore({ token, expires_at: expiresAt.toISOString() });
  } catch (error) {
    if (error instanceof ProfileErasedError) return noStore({ error: "profile_erased" }, 410);
    if (isLifecycleLockFailure(error)) return noStore({ error: "temporarily_unavailable" }, 503);
    throw error;
  }
}
