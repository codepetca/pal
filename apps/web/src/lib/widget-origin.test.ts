import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { widgetCorsHeaders } from "./widget-origin";

function request(origin?: string): NextRequest {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  return new NextRequest("https://pal.example/api/v1/learner/snapshot", {
    headers,
  });
}

test("allows only exact configured browser origins", () => {
  process.env.PAL_ALLOWED_WIDGET_ORIGINS =
    "https://pika.example, http://localhost:3001";
  assert.equal(
    widgetCorsHeaders(request("https://pika.example"))?.get(
      "access-control-allow-origin",
    ),
    "https://pika.example",
  );
  assert.equal(widgetCorsHeaders(request("https://evil.example")), null);
  assert.equal(
    widgetCorsHeaders(request("https://pal.example"))?.get(
      "access-control-allow-origin",
    ),
    "https://pal.example",
  );
  assert.equal(widgetCorsHeaders(request())?.get("vary"), "Origin");
});

test("rejects unsafe or path-bearing origin configuration", () => {
  for (const configured of [
    "http://pika.example",
    "https://pika.example/student",
    "https://user:password@pika.example",
  ]) {
    process.env.PAL_ALLOWED_WIDGET_ORIGINS = configured;
    assert.throws(() => widgetCorsHeaders(request("https://pika.example")));
  }
});
