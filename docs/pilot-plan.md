# Pika–Pal Achievement Pilot Plan

> Time-bound delivery snapshot. The team is in week 4 of an 8-week pilot as of 2026-07-21.
> GitHub issues remain the source of truth for day-to-day task status.

This plan turns the target architecture in [Pika Signal Adapter and Achievement Pipeline](pika-signal-adapter.md) into a focused pilot. It records ownership and checkpoints without changing the durable boundary: Pika owns source facts, and Pal owns achievement interpretation, rewards, and presentation.

## Pilot scope

The pilot supports five learner-facing achievements:

| Achievement | Qualifying Pika facts | Pal result |
|---|---|---|
| First Pika Login | `platform.session.started` | One learner-lifetime award |
| Joined the Class | `classroom.joined` | One award per learner/classroom |
| Weekly Rhythm | `daily_log_week.configured` and distinct `daily_log.completed` dates | Recurring weekly progress and award |
| Ready Early | First `learning_item.viewed` classified `within_24h_of_release` | One award per learner/item |
| On-Time Finish | First `learning_item.completed` classified `on_time` | One award per learner/item |

The pilot includes the embedded vertical roadmap, the initial badge set, and one accessible reward celebration. Additional achievement types, an assignment catalog or incomplete-assignment projection, advanced animations, and ClassOS integration are outside this delivery window.

## Ownership

| Owner | Workstream | Responsibilities |
|---|---|---|
| **Ab** | Pal engineering and experience | Production ingest, validation, durable idempotency, achievement progress and award persistence, learner-world API state, `/embed/roadmap`, and the reward celebration. |
| **Je** | Visual system and artwork | Badge templates and icons, status treatments, accessible color/text combinations, initial badge and pet/reward assets, responsive visual QA, and asset handoff. |
| **Ja** | Achievement design and QA | Achievement rules, recurrence, thresholds, scope, copy, rewards, event-to-achievement mapping, acceptance fixtures, edge-case expectations, and product QA. |
| **St** | Pika integration | Transactional outbox, six authoritative signal hooks, pseudonymous tokens, weekly configuration revisions, authenticated delivery/retry/reconciliation, embed-token handoff, and Pika-side contract tests. |

Ab and St jointly own the cross-project contract tests. Neither side changes a version 1 event field, enum, identity rule, or retry behavior without updating the shared contract first.

## Weeks 4–8

| Week | Required outcome |
|---|---|
| **4 — Align and prove** | Ja freezes the five pilot rules and acceptance examples. Je freezes the badge/status system. St and Ab prove one complete real or contract-fixture signal → durable Pal fact → achievement state → rendered badge path. |
| **5 — Make it durable** | St completes the initial outbox and authoritative emitters. Ab completes production persistence, validation, idempotency, progress, and award storage. Je delivers the initial badges. Ja validates the fixtures. |
| **6 — Make it visible** | Ab delivers the chrome-free embedded roadmap. St completes secure read-token handoff and reconciliation visibility. Je and Ja validate every supported state with representative data. |
| **7 — Integrate and harden** | The team adds the one-time reward celebration and tests retries, concurrent duplicates, delayed/out-of-order delivery, short weeks, schedule revisions, resubmissions, deleted assignments, and archived classes. |
| **8 — Pilot** | The team completes accessibility review, fixes pilot-blocking defects, verifies deployment and failure recovery, runs the learner pilot, and records follow-up work separately from the pilot scope. |

## Delivery checkpoints

### End of week 5: integration gate

A real Pika learner action must travel through the durable outbox and create the correct durable Pal progress or award exactly once. Retry and duplicate delivery must not create extra progress or rewards. If this gate is not met, the pilot narrows to First Pika Login, Joined the Class, and Weekly Rhythm before more badge or animation work is added.

### End of week 8: definition of done

The pilot is complete when:

- all five achievements follow the version 1 event contract and acceptance fixtures;
- Pal retains correct progress and awards across restarts and concurrent duplicate delivery;
- weekly revisions and shortened weeks behave as documented;
- Pika delivery failures are visible and recoverable without blocking learner actions;
- the Achievements destination opens Pal's roadmap inside Pika's content pane;
- awards and claimable rewards apply once, with an accessible reduced-motion experience;
- status uses text and icons as well as color; and
- inspection of representative payloads confirms that no names, assignment content, grades, raw IDs, or raw deadlines cross into Pal.

## Working agreement

This file records the agreed pilot scope, ownership, and gates. Implementation progress belongs in repository issues, tests, and pull requests. Architecture decisions and event semantics belong in [Pika Signal Adapter and Achievement Pipeline](pika-signal-adapter.md), so the long-lived design remains independent of individual staffing.
