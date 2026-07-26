import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PalAchievements } from "./achievements";
import { PalCompanion } from "./companion";
import { createFixturePalClient } from "./fixture-client";
import { PalProvider } from "./provider";
import { PalRewardCelebration } from "./reward-celebration";

test("public surfaces render meaningful status without relying on color", () => {
  const client = createFixturePalClient();
  client.dispatch("reward-earned");
  const snapshot = client.peek();

  const html = renderToStaticMarkup(
    <PalProvider client={client} initialSnapshot={snapshot} theme="dark">
      <PalAchievements />
      <PalCompanion />
      <PalRewardCelebration />
    </PalProvider>,
  );

  assert.match(html, /Your achievement path/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /2 of 4 eligible days/);
  assert.match(html, /Earned/);
  assert.match(html, /Pip, your Pal companion/);
  assert.match(html, /data-pal-variant="responsive"/);
  assert.match(html, /Level 2; 3 day rhythm/);
  assert.match(html, /New Pal reward/);
  assert.match(html, />Continue</);
  assert.match(html, /data-pal-theme="dark"/);
});

test("roadmap renders all fictional semester weeks", () => {
  const client = createFixturePalClient();
  const html = renderToStaticMarkup(
    <PalProvider client={client} initialSnapshot={client.peek()}>
      <PalAchievements />
    </PalProvider>,
  );

  assert.match(html, /Week 1/);
  assert.match(html, /Week 16/);
  assert.equal((html.match(/class="pal-week"/g) ?? []).length, 16);
});
