# @pal/contract

The wire contract between an integration and Pal's ingest API, as code.

`docs/pika-signal-adapter.md` describes the version 1 contract in prose. This package
is the same contract in a form both repos can execute. **Where the two disagree, this
package is correct and the doc is a bug** — file it rather than working around it.

Nothing here touches the rule engine, the database, or learner state. It validates
payloads and describes shapes.

## Who uses it, and how

**Pal (ingest)** — validate before anything else runs:

```ts
import { v1 } from "@pal/contract";

const result = v1.validateV1Event(body);
if (!result.ok) {
  return NextResponse.json({ error: result.error }, { status: 422 });
}
// result.event is a fully typed V1Envelope from here on.
```

**An integration (Pika's adapter)** — build events against the types, so a wrong enum
is a compile error instead of a 422 in production:

```ts
import type { v1 } from "@pal/contract";

const event: v1.LearningItemCompletedEvent = {
  schema_version: 1,
  idempotency_key: `pika:assignment:${itemToken}:completed`,
  learner_id: learnerToken,
  event_type: "learning_item.completed",
  occurred_at: submittedAt.toISOString(),
  metadata: { item_token: itemToken, kind: "assignment", period_key: periodKey, timing },
};
```

Validate in your own tests before the event reaches the outbox. A payload that fails
validation will fail identically at Pal, so catching it locally saves a retry cycle.

**Both** — test against `fixtures/v1/`. `valid/` holds one payload per event type plus
the enum variants; `invalid/` holds payloads that must be rejected, with
`invalid/manifest.json` naming the expected error and the reason for each. Those
fixtures are the seam that lets the two repos develop independently: if Pal's ingest
tests and a producer's adapter tests both pass against them, the integration works
without either side running the other's server.

The fixtures are plain JSON with no TypeScript around them, so a repo that cannot yet
install this package can vendor the directory and still test against the same cases.

`@pal/contract` remains a private workspace package during the pilot; its `0.1.0`
workspace version is not a published release identifier. Until publication is enabled,
Pika vendors the contract source and `fixtures/v1/` from an exact Pal commit and records
that commit in its adapter dependency update. Pal lands support first; Pika updates that
pin and runs the vendored fixture suite before emitting the new optional fields. The first
published package release containing this additive calendar group must receive a minor
version bump.

## What it deliberately does not do

- **No clock.** `validateV1Event` accepts a future-dated `occurred_at`. Rejecting those
  needs a clock, and a clock makes the validator impure. Ingest keeps that guard —
  see `CLOCK_SKEW_MS` in the events route.
- **No idempotency.** Duplicate detection needs storage and is scoped per integration
  (`(integration_id, idempotency_key)`).
- **No truth check.** Only the producer knows whether the asserted fact happened.
- **No runtime dependencies.** This package is imported by two codebases, and a schema
  library here becomes a version conflict in someone else's app. The v1 contract is
  small and closed, so the validators are hand-written.

## Versioning

Two version numbers travel together and mean different things. Keeping them separate is
what stops the whole API surface from moving every time one enum changes.

| | What it versions | Where it lives | Moves when |
|---|---|---|---|
| `/api/v1/events` | The API **surface** — auth scheme, which endpoints exist, error envelope | URL path | Rarely. A breaking change to how the API is *called*. |
| `schema_version` | The **payload** contract for one event | Request body | A field, enum value, or identity rule changes incompatibly. |
| package semver | This package's **API** — exported names and types | `package.json` | Every release, by the rules below. |

Package version bumps:

| Change | Package | `schema_version` |
|---|---|---|
| Add a new event type | minor | unchanged |
| Add an optional metadata field | minor | unchanged |
| Loosen a constraint | minor | unchanged |
| Rename or remove a field, tighten a constraint, change a required field's type | major | **bump** |

Adding an event type breaks nobody: no existing producer emits it and no existing
consumer expects it. Which event types a given integration may send is enforced by that
integration's allow-list, not by the schema version.

An optional field group may still be all-or-none. The original version 1 term
calendar remains the five-field group `term_token`, `term_start_day`,
`term_end_day`, `term_timezone`, and `week_index`; it implies a 16-week roadmap
and remains valid. Adaptive producers add both `term_week_count` and
`week_start_day`, yielding a seven-field group. A producer must send exactly
none, all five, or all seven so consumers never persist a partial assertion.

The rollout order never changes: **Pal ships support for a version first, and a producer
starts emitting it second.** Reversing that fills the producer's outbox with
non-retryable `unsupported_schema_version` failures.

## Adding to the contract

1. Update `docs/pika-signal-adapter.md` — the prose stays the explanation.
2. Update `src/v1/types.ts` and `src/v1/validate.ts`.
3. Add fixtures for the new shape, including at least one that must be rejected.
4. Land in Pal and confirm ingest accepts it before any producer emits it.

Per the pilot plan's working agreement, no version 1 event field, enum, identity rule,
or retry behavior changes without updating this package first.
