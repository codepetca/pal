import { NextRequest, NextResponse } from "next/server";
import {
  LearnerScopeError,
  loadLearnerSnapshot,
} from "@/lib/learner-snapshot";
import {
  bearerToken,
  InvalidReadTokenError,
  verifyPalReadToken,
} from "@/lib/read-token";
import { widgetCorsHeaders } from "@/lib/widget-origin";

export const dynamic = "force-dynamic";

function responseHeaders(cors: Headers): Headers {
  const headers = new Headers(cors);
  headers.set("Cache-Control", "no-store");
  return headers;
}

function deniedHeaders(): Headers {
  return responseHeaders(new Headers({ Vary: "Origin" }));
}

export async function OPTIONS(request: NextRequest) {
  const cors = widgetCorsHeaders(request);
  return cors
    ? new NextResponse(null, { status: 204, headers: responseHeaders(cors) })
    : NextResponse.json(
        { error: "origin_not_allowed" },
        { status: 403, headers: deniedHeaders() },
      );
}

export async function GET(request: NextRequest) {
  const cors = widgetCorsHeaders(request);
  if (!cors) {
    return NextResponse.json(
      { error: "origin_not_allowed" },
      { status: 403, headers: deniedHeaders() },
    );
  }
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: responseHeaders(cors) },
    );
  }
  try {
    const claims = await verifyPalReadToken(token, "learner:read");
    const snapshot = await loadLearnerSnapshot(
      claims.integrationId,
      claims.learnerId,
      undefined,
      {
        supportsCollectibleFinish:
          request.headers.get("x-pal-collectible-finish") === "1",
      },
    );
    return NextResponse.json(snapshot, { headers: responseHeaders(cors) });
  } catch (error) {
    if (error instanceof InvalidReadTokenError) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: responseHeaders(cors) },
      );
    }
    if (error instanceof LearnerScopeError) {
      return NextResponse.json(
        { error: "learner_not_found" },
        { status: 404, headers: responseHeaders(cors) },
      );
    }
    throw error;
  }
}
