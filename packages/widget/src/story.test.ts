import assert from "node:assert/strict";
import test from "node:test";
import {
  createPalStoryPlan,
  MAX_STORY_PERIODS,
  MIN_STORY_PERIODS,
  PIP_STORY_CHAPTERS,
} from "./story";

const coreChapterIds = PIP_STORY_CHAPTERS
  .filter((chapter) => chapter.kind === "core")
  .map((chapter) => chapter.id);

test("catalog contains 24 unique chapters and collectibles", () => {
  assert.equal(PIP_STORY_CHAPTERS.length, 24);
  assert.equal(new Set(PIP_STORY_CHAPTERS.map((chapter) => chapter.id)).size, 24);
  assert.equal(new Set(PIP_STORY_CHAPTERS.map((chapter) => chapter.collectible.id)).size, 24);
  assert.equal(coreChapterIds.length, 8);
});

test("creates one ordered chapter per period for every supported term length", () => {
  for (let totalPeriods = MIN_STORY_PERIODS; totalPeriods <= MAX_STORY_PERIODS; totalPeriods += 1) {
    const plan = createPalStoryPlan(totalPeriods);
    assert.equal(plan.totalPeriods, totalPeriods);
    assert.equal(plan.chapters.length, totalPeriods);
    assert.deepEqual(
      plan.chapters.map((chapter) => chapter.roadmapWeek),
      Array.from({ length: totalPeriods }, (_, index) => index + 1),
    );
    assert.equal(new Set(plan.chapters.map((chapter) => chapter.collectible.id)).size, totalPeriods);
  }
});

test("eight-period plan contains exactly the eight core chapters", () => {
  assert.deepEqual(createPalStoryPlan(8).chapters.map((chapter) => chapter.id), coreChapterIds);
});

test("optional chapters are distributed across acts in a typical term", () => {
  const plan = createPalStoryPlan(16);
  const optionalActs = plan.chapters
    .filter((chapter) => chapter.kind === "optional")
    .map((chapter) => chapter.act);
  assert.deepEqual(
    optionalActs.reduce<Record<number, number>>((counts, act) => {
      counts[act] = (counts[act] ?? 0) + 1;
      return counts;
    }, {}),
    { 1: 1, 2: 1, 3: 3, 4: 3 },
  );
  assert.equal(plan.chapters.find((chapter) => chapter.id === "pip-hatches")?.roadmapWeek, 4);
});

test("expanded plan preserves canonical catalog order and all chapters", () => {
  assert.deepEqual(
    createPalStoryPlan(24).chapters.map((chapter) => chapter.id),
    PIP_STORY_CHAPTERS.map((chapter) => chapter.id),
  );
});

test("six and seven period plans use the documented merged beats", () => {
  const seven = createPalStoryPlan(7);
  assert.deepEqual(seven.chapters[0]?.sourceChapterIds, ["egg-arrives", "long-night"]);
  assert.equal(seven.chapters[0]?.collectible.id, "mystery-egg-v1");
  assert.equal(seven.chapters.at(-1)?.id, "lumi-returns");

  const six = createPalStoryPlan(6);
  assert.deepEqual(six.chapters.at(-1)?.sourceChapterIds, ["share-the-snacks", "lumi-returns"]);
  assert.equal(six.chapters.at(-1)?.collectible.id, "lumi-companion-v1");
});

test("rejects unsupported term lengths instead of silently padding the story", () => {
  assert.throws(() => createPalStoryPlan(5), /supports 6–24/);
  assert.throws(() => createPalStoryPlan(25), /supports 6–24/);
  assert.throws(() => createPalStoryPlan(12.5), /must be an integer/);
});
