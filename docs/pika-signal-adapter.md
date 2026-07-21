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
| Determine scheduled daily-log opportunities, enrolment, holidays, and shortened weeks | Pika |
| Convert Pika-specific records into normalized events | Pika adapter |
| Generate pseudonymous learner/item tokens and event idempotency keys | Pika adapter |
| Persist and deliver events with retries | Pika adapter |
| Reject exact delivery duplicates | Pal ingest |
| Count distinct days, learning items, work sessions, and periods | Pal |
| Define targets, recurrence, badge rules, and rewards | Pal |
| Persist progress and prevent the same scoped award from being granted twice | Pal |
| Render the achievement roadmap and celebrations | Pal |

Pika must not send final decisions such as `weekly_rhythm.earned`. It sends authoritative facts and opportunity context; Pal applies the game rule. This lets a future ClassOS adapter send the same normalized facts without recreating Pal's achievement logic.

## Normalized facts

These names are the target vocabulary. They replace neither the implemented prototype events nor its API allow-list until the corresponding contract changes land.

The first implementation set is:

```text
platform.session.started
classroom.joined
daily_log_week.configured
daily_log.completed
learning_item.available
learning_item.viewed
learning_item.completed
learning_item.deadline_passed
```

Later candidates, after their qualifying rules are defined, are:

```text
planning_surface.viewed
learning_item.progressed
learning_item.revised
term.milestone
```

Pika reports every genuine `platform.session.started`; Pal derives whether it is the learner's first login. `learning_item.available` and `learning_item.deadline_passed` let Pal represent an untouched item and distinguish it from an item that never existed.

Events carry only allow-listed, low-cardinality metadata. Pika computes source-specific classifications before sending them.

```json
{
  "idempotency_key": "pika:assignment:opaque-item-token:completed",
  "learner_id": "pseudonymous-learner-token",
  "event_type": "learning_item.completed",
  "occurred_at": "2026-09-16T18:20:00Z",
  "metadata": {
    "item_token": "opaque-item-token",
    "kind": "assignment",
    "activity_period_key": "2026-fall-week-03",
    "due_period_key": "2026-fall-week-03",
    "timing": "on_time"
  }
}
```

Pal does not receive assignment names, student content, grades, scores, raw student IDs, or raw deadlines merely to calculate a classification.

## Duplicate and aggregation semantics

Events and achievements are not one-to-one.

1. A retry of the same event uses the same idempotency key, and Pal drops it within the authenticated integration. The durable uniqueness scope is `(integration_id, idempotency_key)`.
2. An edit after a completed log does not create another completion transition.
3. Multiple legitimate Pika logs on one date can produce only one outbound `daily_log.completed` fact for that learner/date. Pal independently enforces the same uniqueness.
4. A recurring achievement is unique within its scope, not across the learner's lifetime.

Examples of uniqueness scopes:

```text
Daily-log credit: learner + activity_day
Weekly Rhythm award: learner + achievement_id + academic_week
Learning-item badge: learner + achievement_id + opaque_item_token
Term milestone: learner + achievement_id + term
```

The Pal UI renders stored achievement progress. It does not count raw events in the browser.

## Weekly Rhythm example

Weekly Rhythm is earned once per eligible academic week. A new scoped instance is created for the next week, and the collection may summarize the result as `Weekly Rhythm x 7`.

At or before the start of every academic week, Pika automatically sends one learner-specific `daily_log_week.configured` fact for every active learner, including a zero-opportunity configuration when no Weekly Rhythm instance should exist. Teachers do not initiate or maintain this signal. Every genuine revision has a new event idempotency key and a monotonically increasing `config_version`:

```json
{
  "idempotency_key": "pika:daily-log-week:opaque-config-revision-token",
  "learner_id": "pseudonymous-learner-token",
  "event_type": "daily_log_week.configured",
  "occurred_at": "2026-09-14T11:00:00Z",
  "metadata": {
    "period_key": "2026-fall-week-03",
    "config_version": 2,
    "period_status": "open",
    "eligible_days": 3
  }
}
```

Pika then sends at most one qualifying `daily_log.completed` fact per learner/activity date. The fact means that the learner completed at least one qualifying daily log on that date; it is not one outbound event per classroom entry. The fact names both the activity date and its academic-week instance, so delivery order does not determine where it counts:

```json
{
  "idempotency_key": "pika:daily-log:opaque-completion-token",
  "learner_id": "pseudonymous-learner-token",
  "event_type": "daily_log.completed",
  "occurred_at": "2026-09-16T18:20:00Z",
  "metadata": {
    "period_key": "2026-fall-week-03",
    "activity_day": "2026-09-16"
  }
}
```

Pal calculates the target:

| Eligible reflection days | Target |
|---:|---:|
| 0 | No Weekly Rhythm instance |
| 1 | 1 |
| 2 | 2 |
| 3 | 2 |
| 4 | 3 |
| 5 | 4 |

Weeks with three or more opportunities therefore allow one grace day. The UI communicates the actual week, for example: `2 of 3 scheduled reflection days`, never a fixed `3 of 5` when five opportunities did not exist.

The week configuration excludes dates before enrolment or after withdrawal, non-class days, holidays, cancellations, and waived days. Configuration is unique by learner and `period_key`. Pal keeps the highest `config_version`, ignores older versions that arrive later, and recomputes provisional progress when an open-period revision arrives. A final higher version sets `period_status` to `closed`; later configuration revisions are rejected for that period.

Completion facts are stored even if they arrive before the configuration and are evaluated against the highest accepted version once it is available. A delayed completion may still count after closure when its `period_key` and `activity_day` identify a qualifying day. Pika, not Pal, determines whether a day qualifies; the count in the configuration supplies the opportunity total without disclosing a learner's detailed schedule. Pal does not revoke an achievement already awarded if an open-period revision raises the target.

## Learning-item lifecycle and weekly placement

An assignment outcome node belongs to the week in which the item is due, while a behavior achievement such as Ready Early belongs to the week in which the behavior occurred. Events therefore distinguish `due_period_key` from `activity_period_key` rather than sending the raw release or deadline timestamp.

For an assignment due in Week 3:

1. When the teacher releases it, Pika sends a learner-scoped `learning_item.available` with an opaque `item_token`, `kind: assignment`, `due_period_key: 2026-fall-week-03`, and a monotonically increasing `item_version`. Pal creates a generic assignment-opportunity node in Week 3.
2. On the learner's first open, Pika sends `learning_item.viewed` with the same item token, the activity and due period keys, and a source-side timing classification such as `within_24h_of_release` or `later`. Pal may award Ready Early in the activity week and update the Week 3 item node to show that work has started.
3. After an authoritative submission succeeds, Pika sends `learning_item.completed` with `timing: on_time` or `late`. Pal updates the Week 3 node and plays a positive reward only when the configured achievement rule is satisfied.
4. If the deadline passes without a completion, Pika automatically sends `learning_item.deadline_passed`. Pal marks the known Week 3 node incomplete. A later completion changes the node from incomplete to late.

If the teacher changes the due week before the outcome is final, Pika sends a higher `item_version` of `learning_item.available` with the new `due_period_key`; Pal moves the unresolved node and ignores older versions that arrive later. If no assignment is ever released, Pika sends no learning-item fact and Pal keeps the future week generic.

Pika sends no assignment title, instructions, student work, grade, raw deadline, or raw learner ID in this lifecycle. Pal needs only the pseudonymous learner and item tokens, item kind, period keys, version, and source-side classifications.

## Selected roadmap presentation

The first roadmap uses a simple vertical list of weekly rows. This is the selected direction because it maps directly to weekly achievement instances and is the least complex layout to build, populate, and make responsive.

- Each row represents one academic week.
- Past weeks collapse to a compact result.
- The current week is expanded and shows live progress.
- Future weeks remain generic until Pika supplies real facts; Pal does not invent future assignments.
- Weekly achievements such as Weekly Rhythm and Weekly Planner occupy normal positions in the row.
- Learning-item outcome nodes appear dynamically in their due week; behavior achievements appear in the week where the qualifying behavior occurs.
- Global achievements such as First Pika Login, One Month In, and Halfway Point appear in the relevant week as a larger full-width milestone, not as an ordinary weekly slot.
- Status always uses an icon and text in addition to color.

![Concept mockup of the Pal vertical weekly achievement roadmap embedded in Pika's content pane](assets/pika-pal-roadmap-concept.png)

*Concept mockup only. Labels, visual styling, badge art, and the pet treatment may change during implementation.*

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

Pika obtains a short-lived, learner-scoped embed/read token from its backend. An initial iframe can receive that token through a `postMessage` handshake after the embed loads; the token is not placed in the iframe URL. The contract must use fixed allowed origins and an exact `targetOrigin`, verify both `event.origin` and `event.source`, and bind the exchange to a per-load nonce. The integration secret, raw learner ID, and long-lived credentials never enter the browser. The embedded route contains no duplicate Pika header, sidebar, or authentication screen.

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
- [ ] Hooks at authoritative write points for logs, item publication and deadline expiry, first views, meaningful progress, submissions, revisions, tests, surveys, enrolment, sessions, and term changes
- [ ] Source-side classification for activity date, eligible daily-log days, and early/on-time/late outcomes
- [ ] Instrumentation for successful session starts and calendar/planning-surface visits
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

Pal currently accepts the prototype `assignment.completed` and `daily_checkin.created` events. Within one warm process, its in-memory prototype deduplicates repeated deliveries by idempotency key, and its streak state prevents a second same-day check-in from advancing the streak or paying daily XP again. A cold start or a different serverless instance loses that deduplication state; durable, cross-instance idempotency remains target work.

The generalized event vocabulary, Pika adapter/outbox, qualified-fact layer, recurring achievement progress, and durable award ledger described here are target work and do not exist yet.
