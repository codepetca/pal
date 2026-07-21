# Pika Signal Adapter and Achievement Pipeline

> Target architecture and cross-project build checklist. This design is agreed but not yet implemented.
> Last updated: 2026-07-21

## Core boundary

**Pika determines what happened. The adapter communicates it safely. Pal determines what it earns.**

Pika remains the academic source of truth. Pal remains a platform-agnostic achievement and reward system. Teachers do not configure Pal events, badge rules, or achievement paths.

## Signal chain

```text
Student acts in Pika
    -> Pika saves the authoritative result
    -> Pika's Pal adapter classifies a privacy-safe fact
    -> Pika writes the event to a durable outbox
    -> The adapter calls POST /api/v1/events with retry + idempotency
    -> Pal validates and deduplicates the event
    -> Pal aggregates distinct days, items, and periods
    -> Pal updates achievement progress
    -> Pal awards a badge/reward when its rule is satisfied
    -> The Pal viewer/widget renders progress, status, and animation
```

Pal being unavailable must never prevent a Pika login, log save, assignment edit, or submission. The outbox provides reliable delivery and retry independently of the student's request.

## Ownership

| Responsibility | Owner |
|---|---|
| Decide whether a valid log, view, meaningful work session, submission, or revision occurred | Pika |
| Determine the academic/activity date and source-specific classification such as early, on-time, or late | Pika |
| Determine scheduled reflection opportunities, enrolment, holidays, and shortened weeks | Pika |
| Convert Pika-specific records into normalized events | Pika adapter |
| Generate pseudonymous learner/item tokens and event idempotency keys | Pika adapter |
| Persist and deliver events with retries | Pika adapter |
| Reject exact delivery duplicates | Pal ingest |
| Count distinct days, learning items, work sessions, and periods | Pal |
| Define targets, recurrence, badge rules, and rewards | Pal |
| Persist progress and prevent the same scoped award from being granted twice | Pal |
| Render the achievement roadmap and celebrations | Pal |

Pika must not send final decisions such as `weekly_rhythm.earned`. It sends authoritative facts and opportunity context; Pal applies the game rule. This lets a future ClassOS adapter send the same normalized facts without recreating Pal's achievement logic.

## Initial normalized facts

These names are the target vocabulary. They replace neither the implemented prototype events nor its API allow-list until the corresponding contract changes land.

```text
platform.first_access
classroom.joined
planning_surface.viewed
reflection_week.configured
reflection_day.completed
learning_item.viewed
learning_item.progressed
learning_item.completed
learning_item.revised
term.milestone
```

Events carry only allow-listed, low-cardinality metadata. Pika computes source-specific classifications before sending them.

```json
{
  "idempotency_key": "pika:assignment:opaque-item-token:completed",
  "learner_id": "pseudonymous-learner-token",
  "event_type": "learning_item.completed",
  "occurred_at": "2026-09-16T18:20:00Z",
  "metadata": {
    "kind": "assignment",
    "timing": "on_time"
  }
}
```

Pal does not receive assignment names, student content, grades, scores, raw student IDs, or raw deadlines merely to calculate a classification.

## Duplicate and aggregation semantics

Events and achievements are not one-to-one.

1. A retry of the same event uses the same idempotency key and Pal drops it.
2. An edit after a completed log does not create another completion transition.
3. Multiple legitimate Pika logs on one date can produce only one outbound `reflection_day.completed` fact for that learner/date. Pal independently enforces the same uniqueness.
4. A recurring achievement is unique within its scope, not across the learner's lifetime.

Examples of uniqueness scopes:

```text
Daily reflection credit: learner + activity_day
Weekly Rhythm award: learner + achievement_id + academic_week
Learning-item badge: learner + achievement_id + opaque_item_token
Term milestone: learner + achievement_id + term
```

The Pal UI renders stored achievement progress. It does not count raw events in the browser.

## Weekly Rhythm example

Weekly Rhythm is earned once per eligible academic week. A new scoped instance is created for the next week, and the collection may summarize the result as `Weekly Rhythm x 7`.

Pika sends the week context automatically:

```json
{
  "event_type": "reflection_week.configured",
  "metadata": {
    "period_key": "2026-fall-week-03",
    "eligible_days": 3
  }
}
```

Pika then sends at most one qualifying `reflection_day.completed` fact per learner/activity date. Pal calculates the target:

| Eligible reflection days | Target |
|---:|---:|
| 0 | No Weekly Rhythm instance |
| 1 | 1 |
| 2 | 2 |
| 3 | 2 |
| 4 | 3 |
| 5 | 4 |

Weeks with three or more opportunities therefore allow one grace day. The UI communicates the actual week, for example: `2 of 3 scheduled reflection days`, never a fixed `3 of 5` when five opportunities did not exist.

The week configuration excludes dates before enrolment or after withdrawal, non-class days, holidays, cancellations, and waived days. If Pika changes the eligible-day count before the week closes, it sends a revision using the same period identity. Pal does not revoke an achievement already awarded.

## Selected roadmap presentation

The first roadmap uses a simple vertical list of weekly rows. This is the selected direction because it maps directly to weekly achievement instances and is the least complex layout to build, populate, and make responsive.

- Each row represents one academic week.
- Past weeks collapse to a compact result.
- The current week is expanded and shows live progress.
- Future weeks remain generic until Pika supplies real facts; Pal does not invent future assignments.
- Weekly achievements such as Weekly Rhythm and Weekly Planner occupy normal positions in the row.
- Learning-item achievements appear dynamically in the week where their source event occurs.
- Global achievements such as First Pika Login, One Month In, and Halfway Point appear in the relevant week as a larger full-width milestone, not as an ordinary weekly slot.
- Status always uses an icon and text in addition to color.

The roadmap is achievement state, not a raw event feed. Pal renders persisted progress and awards; the browser does not count signals.

## Selected Pika presentation boundary

Pal exposes a chrome-free route for the complete roadmap:

```text
/embed/roadmap
```

Pika adds a Pal navigation destination and loads this route inside its normal content pane. The initial integration may use an iframe; `@pal/widget` can replace or wrap the embed later without changing achievement ownership or API contracts.

```text
Pika navigation
    -> Pika content pane
    -> Pal /embed/roadmap
```

Pika obtains a short-lived, learner-scoped embed/read token from its backend. An initial iframe can receive that token through an origin-checked `postMessage` handshake after the embed loads; the token is not placed in the iframe URL. The integration secret, raw learner ID, and long-lived credentials never enter the browser. The embedded route contains no duplicate Pika header, sidebar, or authentication screen.

The overlay has a deliberately smaller role:

- A compact pet companion may persist over Pika screens.
- A brief celebration/fireworks layer may appear when a reward is earned.
- The full roadmap does not render as a page-covering overlay.

The current screenshot-backed overlay remains a development sandbox technique; it is not the production content architecture.

## What must be built in Pika

- [ ] Versioned Pal event schemas and metadata allow-lists
- [ ] Pseudonymous learner, group, and learning-item token generation
- [ ] A durable transactional event outbox
- [ ] An adapter delivery worker with authentication, idempotency, retry, and failure visibility
- [ ] Hooks at authoritative write points for logs, first views, meaningful progress, submissions, revisions, tests, surveys, enrolment, and term changes
- [ ] Source-side classification for activity date, eligible reflection days, and early/on-time/late outcomes
- [ ] Instrumentation for successful first access and calendar/planning-surface visits
- [ ] A Pal navigation destination and content-pane embed host
- [ ] A secure short-lived embed/read-token handoff
- [ ] Reconciliation tools for events that were committed in Pika but not yet delivered
- [ ] Contract and integration tests against Pal's ingest API

Most raw timestamps and state already exist in Pika. The new work is reliable normalization and delivery, not a second achievement engine.

## What must be built in Pal

- [ ] Production event persistence, learner locking, and idempotency
- [ ] Expanded event validation and per-integration metadata allow-lists
- [ ] Qualified-fact aggregation with distinct day/item/period uniqueness
- [ ] General achievement definitions for counters, thresholds, scopes, and recurrence
- [ ] Achievement-progress persistence (`current`, `target`, `status`, `earned_at`)
- [ ] An append-only award/unlock ledger with scoped uniqueness
- [ ] Weekly, learning-item, term, and lifetime achievement instances
- [ ] Claimable reward state and one-time reward application
- [ ] Achievement state in the learner-world API
- [ ] A responsive, chrome-free `/embed/roadmap` route
- [ ] An optional compact companion overlay contract separate from the roadmap
- [ ] Roadmap UI, badge status, accessibility treatment, and reward celebrations
- [ ] Tests for retries, concurrent duplicate signals, multiple logs on one day, shortened weeks, schedule revisions, and repeated weekly awards

## Current implementation status

Pal currently accepts the prototype `assignment.completed` and `daily_checkin.created` events. It already deduplicates repeated deliveries by idempotency key, and its streak state prevents a second same-day check-in from advancing the streak or paying daily XP again.

The generalized event vocabulary, Pika adapter/outbox, qualified-fact layer, recurring achievement progress, and durable award ledger described here are target work and do not exist yet.
