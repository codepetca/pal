# Economy and Progression Design

Pal rewards verified learning progress and sustained reflection. XP is immediate
feedback; it is not the product success metric. The primary behaviors are earning
the configured Weekly Rhythm and completing learning items, with on-time work as a
smaller secondary signal.

## Reward policy

| Behavior | XP | Why |
|---|---:|---|
| Learning item completed | 75 | Completion remains meaningful without dominating the term |
| On-time learning item bonus | 25 | Encourages planning while keeping late completion worthwhile |
| Distinct daily log activity day | 10 | Immediate feedback for reflection; semantic dedup pays once |
| Weekly Rhythm earned | 75 | Rewards meeting the producer-configured weekly target, including short weeks |
| Level-up cost | 500 | Keeps the existing progress-bar cadence |

The single source of truth is `packages/engine/src/progression-policy.ts`. The
default rule pack, persisted pipeline, and public fixture all consume it.

There is deliberately no XP multiplier or collection unlock tied to a long daily
streak. Calendar-day streak multipliers over-reward volume, punish weekends and
holidays, and make a fragile counter more valuable than the configured weekly goal.

## Term pacing

A representative 16-week term with 15 on-time learning items and four completed
daily-log days per week produces:

- learning items: 15 × 100 = 1,500 XP
- daily logs: 64 × 10 = 640 XP
- Weekly Rhythms: 16 × 75 = 1,200 XP
- total: 3,340 XP, or six level-ups and 340 XP toward the next level
- ending level: Level 7, because learners start at Level 1

Completing five logs every week raises the term total to 3,500 XP and Level 8. This
keeps assignment/practice progress near 45% of representative XP and consistent
reflection near 55%; neither activity can swamp the other.

These are design assumptions, not outcome targets. Recalibrate after observing a
full pilot term rather than optimizing for XP issuance itself.

## Rhythm counter

The companion counter is a school-day rhythm:

- it advances once for a validated source `activity_day`, not the UTC delivery day;
- ingest bounds that day to UTC−12 through UTC+14 at the event instant and, once
  configured, requires it to match the term timezone;
- a log received before its first weekly configuration is stored without rewards;
  the first configuration settles valid pending logs in source-day order and
  permanently quarantines any that disagree with its timezone. A corrected source
  day can then settle normally without mutating the original fact;
- Friday continues into Monday, so a normal weekend does not reset it;
- same-day and backdated activity is inert;
- a missed school day resets the counter to one on the next valid activity day.

The counter is motivational display state only. Daily XP stays flat and collection
progress depends on earned Weekly Rhythms, so a holiday-calendar limitation cannot
change a learner's material rewards. Pika's configured Weekly Rhythm remains the
authoritative schedule-aware measure.

## Durable collection

Collection keepsakes are idempotent world unlocks persisted in the existing
`world_state.unlocked_object_ids` array:

| Earned Weekly Rhythms | Keepsake |
|---:|---|
| 1 | Study Bird |
| 4 | Study Lamp |
| 8 | Reading Nook |
| 12 | Star Projector |
| 16 | Semester Banner |

An earned Weekly Rhythm emits one internal `WEEKLY_RHYTHM_EARNED` progression event
inside the same learner transaction. It grants XP only for the first durable earned
transition. On every accepted learner event, the persisted pipeline compares the
durable earned-week count with the stored world IDs and emits one exact
`COLLECTION_SYNC` event for each genuinely missing milestone. Existing learners
therefore catch up their collection on their next event without receiving retroactive
XP, and an already-stored unlock is absent from both state changes and the returned
mutation stream. Delivery retries and configuration revisions cannot repay the weekly
reward or duplicate a keepsake.

The first milestone uses `world-study-bird-v1`, not the legacy
`world-bird-v1` ID that the original policy awarded for a seven-day streak.
Historical world IDs remain stored for backward compatibility, but the collection
catalog does not misrepresent that older reward as Weekly Rhythm evidence.

The on-time fish is intentionally different: it remains a one-time celebration
notice, not a durable collection item or consumable inventory. A generalized
append-only UnlockLedger and consumable inventory still require separate database
migrations.

## Level and UI behavior

- `economy.xp` is the spendable balance toward the next level.
- `economy.xp_lifetime` only increases and is not reduced by level-up spending.
- Every 500 XP grants one level and spends 500 XP.
- Level-up and Weekly Rhythm completion set an excited companion mood.
- The v1 snapshot exposes an optional bounded `collection.items` array so older
  hosts remain compatible. `PalCollection` renders the durable keepsakes.

## Measurement plan

Primary pilot KPIs:

1. Weekly Rhythm completion rate: earned Weekly Rhythm instances divided by eligible
   configured weeks.
2. Verified learning-item completion rate, segmented by on-time versus late.

Drivers:

- share of eligible learners recording at least one log in a week;
- median eligible days completed before a Weekly Rhythm is earned.

Guardrails:

- semantic duplicate/rejected-event rate, to detect integration or farming issues;
- reward concentration by behavior, checked against the representative 45/55 item
  versus reflection mix;
- no material reward differences caused only by UTC offset or a normal weekend.

Do not treat XP earned, level reached, or collection size as learning outcomes. They
are diagnostic outputs of the policy and can rise without improved learning quality.
