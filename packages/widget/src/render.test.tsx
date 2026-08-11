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
  // Status reaches a screen reader as words and a sighted student as a shape,
  // so neither depends on the status color.
  assert.match(
    html,
    /<span aria-hidden="true">●<\/span><span class="pal-sr-only">2 of 4 days<\/span>/,
  );
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

test("roadmap shows this week, previews the next, and files the rest", () => {
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

  // The fixture semester sits in week 4 of 16.
  assert.match(html, /aria-current="step"[^>]*>|<h3 id="pal-current-week">Week 4/);
  assert.match(html, /id="pal-next-week"[\s\S]*?Week 5/);

  // Weeks past the preview are not on the page at all.
  assert.doesNotMatch(html, /Week 6/);
  assert.doesNotMatch(html, /Week 16/);

  // The three finished weeks are filed in history, closed until asked for.
  assert.equal((html.match(/class="pal-history-week pal-rise"/g) ?? []).length, 3);
  assert.match(html, /class="pal-history-toggle[^"]*"[^>]*aria-expanded="false"/);
  assert.equal((html.match(/data-open="true"/g) ?? []).length, 0);
});

test("companion owns the complete portable cat surface", () => {
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
  // The cat is the whole surface: no scenery ships with it, and the only
  // images fetched are the poses this mood can show.
  assert.doesNotMatch(html, /grass/);
  assert.equal((html.match(/crossorigin="anonymous"/g) ?? []).length, 2);
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
