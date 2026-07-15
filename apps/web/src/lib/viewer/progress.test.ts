import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  progressFraction,
  percentComplete,
  currentIndex,
  nodeStatus,
  progressT,
} from "./progress";
import { layoutNodes, makeRng, hashSeed } from "./path-curve";
import { pose, jumpPose, gaitForSpeed } from "./animation";

describe("progress", () => {
  it("computes fraction and percent, clamped", () => {
    assert.equal(progressFraction(5, 10), 0.5);
    assert.equal(percentComplete(5, 10), 50);
    assert.equal(percentComplete(0, 10), 0);
    assert.equal(percentComplete(10, 10), 100);
    // Over/under-shoot is clamped, not extrapolated.
    assert.equal(percentComplete(99, 10), 100);
    assert.equal(percentComplete(-3, 10), 0);
  });

  it("treats an empty course as complete", () => {
    assert.equal(progressFraction(0, 0), 1);
    assert.equal(progressT(0, 0), 0);
  });

  it("currentIndex is the first unfinished station, resting on the last when done", () => {
    assert.equal(currentIndex(0, 10), 0);
    assert.equal(currentIndex(4, 10), 4);
    assert.equal(currentIndex(10, 10), 9); // finished → stands on final station
  });

  it("labels stations done/current/locked around the frontier", () => {
    assert.equal(nodeStatus(2, 4), "done");
    assert.equal(nodeStatus(4, 4), "current");
    assert.equal(nodeStatus(5, 4), "locked");
  });

  it("progressT maps the current station onto [0,1] across segments", () => {
    assert.equal(progressT(0, 5), 0);
    assert.equal(progressT(4, 5), 1); // 4 finished of 5 → last of 4 segments
    assert.equal(progressT(2, 5), 0.5);
  });
});

describe("path-curve", () => {
  it("is deterministic for a given seed and count", () => {
    const a = layoutNodes(10, 1234);
    const b = layoutNodes(10, 1234);
    assert.deepEqual(a, b);
    assert.equal(a.length, 10);
  });

  it("changes with the seed", () => {
    const a = layoutNodes(10, 1);
    const b = layoutNodes(10, 2);
    assert.notDeepEqual(a, b);
  });

  it("advances forward in +z row over row", () => {
    // perRow default is 4; row 0 stations should sit ahead of row 2 stations.
    const n = layoutNodes(12, 42);
    assert.ok(n[0].z < n[8].z, "later rows should have larger z");
  });

  it("hashSeed is stable and makeRng stays in [0,1)", () => {
    assert.equal(hashSeed("otter-7f3"), hashSeed("otter-7f3"));
    const rng = makeRng(7);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1);
    }
  });
});

describe("animation", () => {
  it("idle stays subtle", () => {
    for (let t = 0; t < 4; t += 0.25) {
      const p = pose("idle", t);
      for (const v of [p.leftArm, p.rightArm, p.leftLeg, p.rightLeg, p.bodyY]) {
        assert.ok(Math.abs(v) < 0.15, `idle angle too large: ${v}`);
      }
      assert.equal(p.rootY, 0);
    }
  });

  it("walk counter-swings legs and opposite arms", () => {
    // Quarter cycle into the walk, swing = sin > 0.
    const p = pose("walk", (Math.PI / 2) / 6); // phase = t*speed(6) = PI/2
    assert.ok(p.leftLeg > 0 && p.rightLeg < 0, "legs antiphase");
    // Left leg forward pairs with right arm forward, left arm back.
    assert.ok(Math.sign(p.rightArm) === Math.sign(p.leftLeg), "right arm swings with left leg");
    assert.ok(Math.sign(p.leftArm) !== Math.sign(p.leftLeg), "left arm opposes left leg");
  });

  it("run has larger stride than walk at the swing peak", () => {
    const walkPeak = pose("walk", (Math.PI / 2) / 6).leftLeg;
    const runPeak = pose("run", (Math.PI / 2) / 10).leftLeg;
    assert.ok(runPeak > walkPeak, "run stride should exceed walk stride");
  });

  it("jump arc lifts off the ground and returns", () => {
    // Take-off and landing are on the ground (within float tolerance).
    assert.ok(Math.abs(jumpPose(0).rootY) < 1e-9);
    assert.ok(Math.abs(jumpPose(1).rootY) < 1e-9);
    const mid = jumpPose(0.5).rootY;
    assert.ok(mid > 1, "should be airborne mid-jump");
    // Apex is the highest point of the arc.
    assert.ok(mid >= jumpPose(0.25).rootY);
    assert.ok(mid >= jumpPose(0.75).rootY);
  });

  it("gaitForSpeed picks idle/walk/run by threshold", () => {
    assert.equal(gaitForSpeed(0), "idle");
    assert.equal(gaitForSpeed(3), "walk");
    assert.equal(gaitForSpeed(9), "run");
  });
});
