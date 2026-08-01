import type { NextRequest } from "next/server";

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const candidate of (process.env.PAL_ALLOWED_WIDGET_ORIGINS ?? "").split(",")) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const url = new URL(trimmed);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.origin !== trimmed.replace(/\/$/, "")
    ) {
      throw new Error(
        "PAL_ALLOWED_WIDGET_ORIGINS must contain exact HTTPS origins or HTTP localhost origins",
      );
    }
    origins.add(url.origin);
  }
  return origins;
}

export function widgetCorsHeaders(request: NextRequest): Headers | null {
  const origin = request.headers.get("origin");
  if (!origin) return new Headers({ Vary: "Origin" });
  if (!configuredOrigins().has(origin)) return null;
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
}
