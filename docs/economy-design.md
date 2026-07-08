**Economy design**

When a student completes an assignment / their daily logs / a practice test, they will gain a certain amount of points.

There will be a streak to keep track of the student’s consistency on daily logs.

After gaining a certain amount of points, the student will have their level increased and the points will be expended.

Each level increase should correspond to some changes in the world or pet.

**Numbers** (can be changed)

Assignments / practice quiz (on time): 200pt

Assignments / practice quiz (late): 50pt

Daily logs: 10pt \* max(3, daily\_logs\_streak / 5\)

Level up cost: 500pt \* current\_level

**Calculations**

Total exp possible (approximately): 200pt \* 15 \+ 30pt \* 150 \= 7500pt

Total level possible: level 5 \+ 1500pt left

**Visuals**

There should be a progress bar indicating the level and exp needed to reach the next level.

There should be a visual representation of the streak in the progress bar.

Ideally, there should be animations for gaining exp and leveling up.

**Concerns / Improvements**

\- Can consider adding achievements

\- Can consider adding expendable resources (e.g. food to feed pets, coins to buy cosmetics, etc)

\- How can we ensure that students actually completed their assignments? Since the Pika system is not linked to codeHS / Github, the students can submit without actually finishing the lessons.

\- How do we detect when a student has finished writing their daily log? We can’t have the exp gain trigger when the student types a letter.