import assert from "node:assert/strict";
import test from "node:test";
import { rewardLoadoutSlot } from "@/lib/reward-loadout";

test("only companions and wallpapers have loadout slots", () => {
  assert.equal(rewardLoadoutSlot("companion"), "companion");
  assert.equal(rewardLoadoutSlot("wallpaper"), "wallpaper");
  assert.equal(rewardLoadoutSlot("keepsake"), undefined);
});
