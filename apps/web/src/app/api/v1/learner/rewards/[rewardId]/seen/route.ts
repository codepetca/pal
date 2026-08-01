import { NextRequest, NextResponse } from "next/server";
import {
  acknowledgeLearnerReward,
  LearnerScopeError,
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

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function OPTIONS(request: NextRequest) {
  const cors = widgetCorsHeaders(request);
  return cors
    ? new NextResponse(null, { status: 204, headers: responseHeaders(cors) })
    : NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ rewardId: string }> },
) {
  const cors = widgetCorsHeaders(request);
  if (!cors) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: responseHeaders(cors) },
    );
  }
  const { rewardId } = await context.params;
  if (!uuid(rewardId)) {
    return NextResponse.json(
      { error: "invalid_reward_id" },
      { status: 422, headers: responseHeaders(cors) },
    );
  }
  try {
    const claims = await verifyPalReadToken(token, "reward:ack");
    await acknowledgeLearnerReward(
      claims.integrationId,
      claims.learnerId,
      rewardId,
    );
    return new NextResponse(null, { status: 204, headers: responseHeaders(cors) });
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
