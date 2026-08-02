import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@pal/db";
import { getOrCreateLearnerIdentity } from "@/lib/db-learner";
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

  const integration = await resolveIntegration(configuredIntegration);
  const learnerId = await getOrCreateLearnerIdentity(
    getDb(),
    integration.id,
    validation.learnerId,
  );
  const { token, expiresAt } = await mintPalReadToken({
    learnerId,
    integrationId: integration.id,
  });

  return noStore({ token, expires_at: expiresAt.toISOString() });
}
