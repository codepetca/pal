import { lifecycleTransaction, ProfileErasedError, isLifecycleLockFailure } from "@/lib/profile-lifecycle";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@pal/db";
import { provisionActiveLearner } from "@/lib/db-learner";
import { identifyIntegration, resolveIntegration } from "@/lib/integration-auth";
import { mintPalReadToken } from "@/lib/read-token";
import { validateReadTokenRequest } from "@/lib/read-token-request";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Server-to-server only. The integration secret authenticates Pika; the
// returned learner-scoped token is the only Pal credential that reaches the
// browser.
export async function POST(req: NextRequest) {
  const configuredIntegration = identifyIntegration(
    req.headers.get("authorization"),
  );
  if (!configuredIntegration) {
    return noStore({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: "invalid_request", detail: "invalid JSON" }, 400);
  }
  const validation = validateReadTokenRequest(body);
  if (!validation.ok) {
    return noStore(
      { error: "invalid_learner_id", detail: validation.detail },
      422,
    );
  }

  try {
    const integration = await resolveIntegration(configuredIntegration);
    const { token, expiresAt } = await lifecycleTransaction(getDb(), async (tx) => {
      const learnerId = await provisionActiveLearner(
        tx,
        integration.id,
        validation.learnerId,
      );
      return mintPalReadToken({
        learnerId,
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
