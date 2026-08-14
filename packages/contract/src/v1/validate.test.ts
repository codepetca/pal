import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { V1_EVENT_TYPES, type V1Error } from "./types";
import type { DailyLogWeekConfiguredEvent } from "./types";
import { validateV1Event } from "./validate";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/v1");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fixtureNames(dir: string): string[] {
  return readdirSync(join(FIXTURES, dir))
    .filter((name) => name.endsWith(".json") && name !== "manifest.json")
    .sort();
}

// The fixtures are the shared artifact between the two repos: Pal proves ingest
// accepts and rejects exactly these, and a producer proves its adapter emits
// payloads that match them. If these two suites pass on both sides, the
// integration works without either repo running the other's server.

test("every valid fixture is accepted", () => {
  const names = fixtureNames("valid");
  assert.ok(names.length > 0, "expected valid fixtures to exist");

  for (const name of names) {
    const result = validateV1Event(readJson(join(FIXTURES, "valid", name)));
    assert.equal(
      result.ok,
      true,
      `${name} should be accepted but failed: ${result.ok ? "" : `${result.error} — ${result.detail}`}`
    );
  }
});

test("every v1 event type has at least one valid fixture", () => {
  const covered = new Set(
    fixtureNames("valid").map((name) => {
      const payload = readJson(join(FIXTURES, "valid", name)) as { event_type: string };
      return payload.event_type;
    })
  );

  for (const eventType of V1_EVENT_TYPES) {
    assert.ok(covered.has(eventType), `no valid fixture covers ${eventType}`);
  }
});

test("every invalid fixture is rejected with its documented error", () => {
  const manifest = readJson(join(FIXTURES, "invalid", "manifest.json")) as {
    cases: Record<string, { error: V1Error; why: string }>;
  };

  const names = fixtureNames("invalid");
  assert.deepEqual(
    names,
    Object.keys(manifest.cases).sort(),
    "every invalid fixture needs a manifest entry, and every entry needs a file"
  );

  for (const name of names) {
    const result = validateV1Event(readJson(join(FIXTURES, "invalid", name)));
    assert.equal(result.ok, false, `${name} should be rejected`);
    if (!result.ok) {
      assert.equal(
        result.error,
        manifest.cases[name].error,
        `${name} rejected as ${result.error}, manifest says ${manifest.cases[name].error}`
      );
    }
  }
});

test("metadata keys outside the allow-list are rejected, not ignored", () => {
  // The privacy boundary depends on this being a rejection rather than a strip:
  // silently dropping a key would let a producer believe it was delivered.
  const base = readJson(join(FIXTURES, "valid", "classroom-joined.json")) as Record<string, unknown>;
  const widened = {
    ...base,
    metadata: { ...(base.metadata as object), classroom_name: "Period 2 Biology" },
  };

  const result = validateV1Event(widened);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "invalid_metadata");
});

test("envelope keys outside the allow-list are rejected, not forwarded", () => {
  const base = readJson(join(FIXTURES, "valid", "classroom-joined.json")) as Record<string, unknown>;

  for (const widened of [
    { ...base, email: "learner@example.com" },
    { ...base, title: "Period 2 Biology" },
    { ...base, student_id: "raw-database-id" },
    { ...base, debug: { request_id: "trace-123" } },
  ]) {
    const result = validateV1Event(widened);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "invalid_envelope");
  }
});

test("a future-dated event still validates — the clock check belongs to ingest", () => {
  // Documents a deliberate boundary. The validator is pure and has no clock, so
  // ingest keeps its own future-date guard; see the events route.
  const base = readJson(join(FIXTURES, "valid", "daily-log-completed.json")) as Record<
    string,
    unknown
  >;
  const result = validateV1Event({ ...base, occurred_at: "2099-01-01T00:00:00Z" });
  assert.equal(result.ok, true);
});

test("a payload that is not an object is rejected without throwing", () => {
  for (const payload of [null, undefined, 42, "event", [], true]) {
    const result = validateV1Event(payload);
    assert.equal(result.ok, false, `${JSON.stringify(payload) ?? "undefined"} should be rejected`);
  }
});

test("the producer type requires the complete term calendar group", () => {
  const partial: DailyLogWeekConfiguredEvent = {
    schema_version: 1,
    idempotency_key: "partial-calendar",
    learner_id: "opaque-learner",
    event_type: "daily_log_week.configured",
    occurred_at: "2026-09-14T11:00:00Z",
    // @ts-expect-error A producer cannot construct a type-valid partial calendar.
    metadata: {
      period_key: "fall-week-03",
      config_version: 1,
      period_status: "open",
      eligible_days: 3,
      term_token: "fall-2026",
    },
  };
  assert.ok(partial);
});
