# Economy Design

Students will earn EXP when they complete assignments, daily logs, or practice tests.

A streak counter will track how consistently a student completes their daily logs.

Once a student accumulates enough EXP, they will level up, and the required EXP will be deducted. 

Each level-up should trigger visual or progression changes in the virtual world or for their pet.

---

## Numbers (Subject to Change)

*   **Assignments / practice quizzes:** 150 xp
*   **Assignments / practice quizzes (on time bonus):** 50 xp
*   **Daily logs:** 10 xp
*   **Daily logs (streak bonus):** +3 xp every 2 days (max +15 xp)
*   **Level-up cost:** 500 exp

---

## Calculations

*   **Approximate total EXP possible:** 200 xp * 15 + 20 xp * 150 = 6,000 xp
*   **Maximum level achievable:** Level 12

---

## Visuals

*   A progress bar should display the student's current level and the EXP required to reach the next level.
*   The daily log streak should be visually integrated into the progress bar.
*   Ideally, custom animations will play when gaining EXP and leveling up.

---

## Concerns & Potential Improvements

*   Consider introducing achievement milestones.
*   Consider implementing expendable resources, such as food to feed pets or coins to purchase cosmetic items.
*   How can we verify that students have actually completed their assignments? Since the Pika system is not integrated with CodeHS or GitHub, students could currently submit completions without actually finishing the lessons.
*   How do we detect when a student has completed writing their daily log? The EXP reward should not trigger prematurely (e.g., as soon as they type a single character).