# Economy Design

Students will earn EXP when they complete assignments, daily logs, or practice tests.

A streak counter will track how consistently a student completes their daily logs.

Once a student accumulates enough EXP, they will level up, and the required EXP will be deducted.

Each level-up should trigger visual or progression changes in the virtual world or for their pet.

---

## Numbers (Subject to Change)

- **Assignments / practice quizzes:** 150 xp
- **Assignments / practice quizzes (on time bonus):** 50 xp
- **Daily logs:** 10 xp
- **Daily logs (streak bonus):** +3 xp every 2 days (max +15 xp)
- **Level-up cost:** 500 exp

The streak bonus tiers land on days 2, 4, 6, 8, and 10, and they stack: a 10-day streak earns the full +15 on top of the 10 xp base, and holds there. All of these numbers live in one place — the constants at the top of `packages/engine/src/default-rules.ts`.

---

## Calculations

- **Approximate total EXP possible:** 200 xp × 15 assignments + ~20 xp × 150 daily logs = 6,000 xp
  - The 20 xp per daily log is an _average_, not a rate from the table above: a log is worth 10 xp with no streak and 25 xp on a maxed streak, so this assumes students hold a long streak most of the time.
- **Level-ups that buys:** 6,000 / 500 = 12
- **Maximum level achievable:** **Level 13** — students start at level 1, so 12 level-ups lands them on 13. (Worth settling before anyone builds the progress bar: if "max level 12" is what we want, students should start at level 0.)

---

## Visuals

- A progress bar should display the student's current level and the EXP required to reach the next level.
  - Render `economy.xp` (the balance toward the next level), not `economy.xp_lifetime`. Levelling spends `xp`, so the bar empties on level-up; lifetime xp only ever climbs, and is what achievements will key on.
- The daily log streak should be visually integrated into the progress bar.
- Ideally, custom animations will play when gaining EXP and leveling up.

---

## How it behaves today

- **Streaks are derived, never reported.** A check-in on the day after the last one advances the streak; a gap resets it to 1; a second check-in on the same day does not advance it twice. No "streak broken" event is needed, and an integration cannot invent a streak for a student.
- **Levelling runs in the engine's derived-event cascade:** xp is granted → `XP_CHANGED` → the `level-up` rule spends 500 xp and grants a level → the pet celebrates. Banking several levels' worth of xp in one event levels up to three times; any surplus stays banked and levels on the next event.

---

## Concerns & Potential Improvements

- Consider introducing achievement milestones.
- Consider implementing expendable resources, such as food to feed pets or coins to purchase cosmetic items.
- How can we verify that students have actually completed their assignments? Since the Pika system is not integrated with CodeHS or GitHub, students could currently submit completions without actually finishing the lessons.
- How do we detect when a student has completed writing their daily log? The EXP reward should not trigger prematurely (e.g., as soon as they type a single character).
- A student's streak day is currently UTC, so a student checking in late in the evening west of UTC can be credited to the next day and lose a streak they earned. Revisit when integrations can declare a timezone.
- A broken streak is only noticed on the student's _next_ check-in, so a stale `streak_current` can display for days. If the streak needs to visibly reset the moment it breaks, that requires a per-learner scheduled event.
