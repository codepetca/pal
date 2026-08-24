import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@pal/db";
import {
  RewardLoadoutWriteError,
  setStoryRewardLoadout,
  type RewardLoadoutSlot,
} from "@/lib/reward-loadout";
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

function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

export async function POST(request: NextRequest) {
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
    const claims = await verifyPalReadToken(token, "reward:equip");
    if (Number(request.headers.get("content-length") ?? 0) > 2_048) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 422, headers: responseHeaders(cors) },
      );
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 2_048) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 422, headers: responseHeaders(cors) },
      );
    }
    const parsedBody: unknown = JSON.parse(rawBody);
    if (
      typeof parsedBody !== "object" ||
      parsedBody === null ||
      Array.isArray(parsedBody)
    ) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 422, headers: responseHeaders(cors) },
      );
    }
    const body = parsedBody as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => key !== "slot" && key !== "rewardGrantId",
      )
    ) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 422, headers: responseHeaders(cors) },
      );
    }
    const slot = body.slot;
    const rewardGrantId = body.rewardGrantId;
    if (
      (slot !== "companion" && slot !== "wallpaper") ||
      (rewardGrantId !== null && !uuid(rewardGrantId))
    ) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 422, headers: responseHeaders(cors) },
      );
    }

    const db = getDb();
    await setStoryRewardLoadout(db, {
      integrationId: claims.integrationId,
      learnerId: claims.learnerId,
      slot: slot as RewardLoadoutSlot,
      rewardGrantId,
    });
    return new NextResponse(null, { status: 204, headers: responseHeaders(cors) });
  } catch (error) {
    if (error instanceof InvalidReadTokenError) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: responseHeaders(cors) },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 422, headers: responseHeaders(cors) },
      );
    }
    if (error instanceof RewardLoadoutWriteError) {
      return NextResponse.json(
        { error: error.code },
        {
          status: error.code === "learner_not_found" ? 404 : 422,
          headers: responseHeaders(cors),
        },
      );
    }
    throw error;
  }
}
