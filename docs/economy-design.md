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
  every accepted higher configuration settles the remaining allowance from its
  latest `eligible_days`, never more than five total, in source-day order. Durable
  internal pending and settlement facts emit one `DAILY_LOG_REWARD_SETTLED` event
  per newly settled day, making flat XP exact-once even when a newer day already
  anchors the rhythm. Unmarked facts from before this policy are treated as already
  paid, so rollout cannot double-pay them;
- facts beyond the current eligible-day allowance remain pending until a higher
  accepted configuration releases them. A period has five qualifying reward
  slots. Before configuration, a sixth unclassified source day is rejected;
  after configuration, immutable timezone-quarantined facts use a separate
  bounded correction reserve, so a corrected source day can settle without
  mutating the original. No more than ten source facts (five qualifying plus
  five quarantined) can be retained for one version 1 period;
- Friday continues into Monday, so a normal weekend does not reset it;
- same-day and backdated activity cannot move the rhythm, although a distinct
  newly settled older source day still earns its flat daily XP;
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
XP or duplicate collection items.

## Reward progression projection

The learner snapshot can include an optional `progression` projection. It turns
durable week, level, streak, and achievement state into a visible reward path;
it does not mutate that state or bypass the rule engine. Keeping the field
optional preserves schema-version-1 compatibility for integrations pinned to an
older widget/API pair.

- A deterministic story plan selects one chapter for each supported 6–24 week
  instructional term. Eight core chapters preserve the emotional arc while
  optional chapters let longer terms breathe.
- The first calendar-bearing weekly configuration persists the complete plan
  under the learner row lock. Each later configuration binds its opaque period
  to that plan's matching ordinal; snapshots read this stored order rather than
  silently generating a new schedule. The original five-field calendar form
  remains supported as a 16-week plan.
- Story content is registered by immutable story ID and version. The default
  reference is used only for new plans; persisted plans and reward notices
  continue resolving through their assigned version, so a new story or Pip v2
  does not require a database or learning-event contract change.
- Every configured instructional period becomes due on the local calendar day
  after its own instructional end: Saturday after a normal Friday, or the next
  day when the authoritative term ends midweek. The first partial week begins on
  `term_start_day`; later normal weeks begin Monday. A later instructional week,
  holiday, or break never moves the current period's due day. Boundaries use the
  term's authoritative IANA timezone. For defensive compatibility with the
  existing Pika contract, a contract-valid weekend start uses the following
  Monday-Friday instructional span and becomes due that Saturday.
- A version-controlled Vercel cron wakes the worker daily. It pages through
  learners with ungranted overdue assignments, takes the same per-learner row
  lock as event ingest, and reconciles every overdue week for that learner in one
  transaction. The current production bound is 10,000 learners per invocation;
  reaching it returns an alertable incomplete response. Accepted events call the
  same idempotent reconciler, but learner activity is not required: missed cron
  runs recover on a later daily run.
- The reconciler writes one append-only `story_chapter` ownership grant using a
  stored weekly configuration fact as provenance. It never writes
  XP, achievement events, student activity, or a finish. The authenticated
  snapshot projects sketch when that week's durable Weekly Rhythm is not earned
  and color when it is earned. An achievement earned before the due day does not
  create early ownership; a delayed valid achievement upgrades the existing
  collectible's presentation without inserting another grant.
- Schedule-grant eligibility is fail-closed until
  `PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT` is configured. Both the provenance
  fact and its typed schedule may predate deployment, but the due instant must be
  at or after that boundary, so deploying the feature never awards older weeks
  or loses future work. `CRON_SECRET` separately authenticates
  the daily cron route and is not an eligibility input for accepted-event
  recovery. Level, streak, and assignment milestones may award titles or
  ordinary rewards, but never color story props.
- Pip's reveal is scheduled by the generated plan (Week 4 in the standard
  16-week plan). The canonical progression projector evaluates the persisted
  plan and durable awards once, then emits a single display-ready
  `companionReveal` decision. The companion surface renders that decision and
  never rebuilds eligibility from roadmap weeks or duplicate unlock flags.
- Story titles are Gentle Keeper, Brave Beginner, Try-Again Chef, and True
  Friend. Behavior titles remain Rhythm Builder, On-Time Pro, and Level Leader.
  Each award stores both source occurrence and PAL grant order. The display
  keeps the most recently granted title across later snapshots without delayed
  delivery rewriting the learner's visible history; a story title wins when
  one action awards multiple titles at the same time. Historical achievements
  never create reward grants; every new grant has an exact source fact.
- The widget gives every roadmap week a collectible-style slot while concealing
  locked art, names, story copy, and title definitions in the raw projection as
  well as the UI. Once the chapter is granted, that week's slot reveals one
  sketch or full-color collectible (at most one reward per period). Older
  snapshots without `progression` keep the existing cat and achievement UI.
- Pal's authenticated snapshot producer is the authority for story awards and
  reveal eligibility. The widget's network parser validates shape, bounds, and
  asset origins; it deliberately does not maintain a second story engine or
  attempt to prove entitlement from other fields in the same response.
- The active daily scheduler catches up every overdue post-rollout assignment
  for each selected learner. Story copy, collectible briefs, and scheduling
  rules are defined in
  [Pip's First Recipe — Story Collection Design](story-collection-design.md).

The first milestone uses `world-study-bird-v1`, not the legacy
`world-bird-v1` ID that the original policy awarded for a seven-day streak.
Historical world IDs remain stored for backward compatibility, but the collection
catalog does not misrepresent that older reward as Weekly Rhythm evidence.

Each newly earned achievement may create one transient celebration notice that
projects the achievement's canonical identity and artwork. These notices are not
durable collection items or inventory, and acknowledgement never revokes the
achievement. A generalized append-only UnlockLedger and consumable inventory still
require separate database migrations.

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
