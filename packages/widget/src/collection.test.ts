import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionItemsForUnlocks } from "./fixture-client";

test("does not relabel the legacy streak bird as a Weekly Rhythm keepsake", () => {
  assert.deepEqual(collectionItemsForUnlocks(["world-bird-v1"]), []);
  assert.deepEqual(
    collectionItemsForUnlocks(["world-study-bird-v1"]).map((item) => item.label),
    ["Study Bird"],
  );
});
