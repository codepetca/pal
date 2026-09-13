import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@pal/db";
import { identifyIntegration, resolveIntegration } from "./integration-auth";
import { canonicalUuid, erasureEnabled, validAnyErasureRequest, requestPolicy } from "./profile-erasure-contract";
import { beginProfileErasure, ErasureConflict, getProfileErasure, progressProfileErasure } from "./profile-erasure";

const respond = (body: unknown, status: number) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function profileErasureHttp(req: NextRequest, operationId?: string) {
  try {
    const configured = identifyIntegration(req.headers.get("authorization"));
    if (!configured) return respond({ error: "unauthorized" }, 401);
    const selected = req.headers.get("Pal-Erasure-Policy");
    // No query parameters, tenant override, status body or browser access.
    if (req.nextUrl.search || (selected !== null && (req.method !== "GET" || selected !== "pika-live-v1")) || (req.method === "GET" &&
        (req.body !== null || !canonicalUuid(operationId)))) {
      return respond({ error: "invalid_erasure_request" }, 422);
    }
    const body: unknown = req.method === "POST" ? await req.json().catch(() => null) : null;
    if (req.method === "POST" && !validAnyErasureRequest(body)) {
      return respond({ error: "invalid_erasure_request" }, 422);
    }
    const integration = await resolveIntegration(configured);
    if (!erasureEnabled(integration.id)) return respond({ error: "erasure_not_enabled" }, 403);
    const policy = req.method === "GET" ? selected ?? "strict-v1" :
      validAnyErasureRequest(body) ? requestPolicy(body) : "strict-v1";
    if (policy === "pika-live-v1" && integration.slug !== "pika") {
      return respond({ error: "erasure_not_enabled" }, 403);
    }
    if (req.method === "GET") {
      const receipt = await getProfileErasure(getDb(), integration.id, operationId!, policy);
      return receipt ? respond(receipt, 200) : respond({ error: "erasure_operation_not_found" }, 404);
    }
    if (!validAnyErasureRequest(body)) return respond({ error: "invalid_erasure_request" }, 422);
    const saved = await beginProfileErasure(getDb(), integration.id, body);
    // Begin is durable before any copy verification or cleanup can fail.
    const receipt = saved.status === "completed" ? saved :
      await progressProfileErasure(getDb(), integration.id, saved.operation_id, undefined, policy);
    if (!receipt) return respond({ error: "erasure_pending" }, 503);
    return respond(receipt, receipt.status === "completed" ? 200 : 202);
  } catch (error) {
    if (error instanceof ErasureConflict) return respond({ error: error.code }, 409);
    // Never log input, credentials, database query parameters, or copy details.
    return respond({ error: "erasure_pending" }, 503);
  }
}

export function erasureMethodNotAllowed() {
  return respond({ error: "method_not_allowed" }, 405);
}
