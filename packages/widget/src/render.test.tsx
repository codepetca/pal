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
    <PalProvider
      client={client}
      initialSnapshot={snapshot}
      scopeKey="fixture-learner"
      theme="dark"
      density="compact"
      motion="reduced"
      viewport="narrow"
    >
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
  assert.match(html, /Level 2; 3 day rhythm/);
  assert.match(html, /A treat for Pip!/);
  assert.match(html, />Continue</);
  assert.match(html, /data-pal-theme="dark"/);
  assert.match(html, /data-pal-density="compact"/);
  assert.match(html, /data-pal-motion="reduced"/);
  assert.match(html, /data-pal-viewport="narrow"/);
  assert.doesNotMatch(html, /aria-label="New Pal reward"/);
});

test("roadmap renders all fictional semester weeks", () => {
  const client = createFixturePalClient();
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="fixture-learner"
    >
      <PalAchievements />
    </PalProvider>,
  );

  assert.match(html, /Week 1/);
  assert.match(html, /Week 16/);
  assert.equal((html.match(/class="pal-week"/g) ?? []).length, 16);
});

test("companion owns the complete portable cat-on-grass surface", () => {
  const client = createFixturePalClient();
  const snapshot = client.peek();
  snapshot.companion.assetUrl = "https://pal.example/assets/pets/default.png";
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={snapshot}
      scopeKey="fixture-learner"
      motion="reduced"
    >
      <PalCompanion scale={1.2} />
    </PalProvider>,
  );

  assert.match(html, /class="pal-companion-stage"/);
  assert.match(html, /class="pal-companion-grass"/);
  assert.match(html, /https:\/\/pal\.example\/assets\/pets\/grass\.png/);
  assert.match(html, /--pal-companion-cat-height:12rem/);
  assert.doesNotMatch(html, /data-pal-variant=/);
});

test("host-managed rewards leave dialog and focus ownership to the host", () => {
  const client = createFixturePalClient();
  client.dispatch("reward-earned");
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="fixture-learner"
    >
      <PalRewardCelebration hostManaged />
    </PalProvider>,
  );

  assert.match(html, /class="pal-celebration"/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.doesNotMatch(html, /aria-modal=/);
  assert.doesNotMatch(html, /aria-labelledby=/);
  assert.doesNotMatch(html, /aria-describedby=/);
});
