import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PalAchievements } from "./achievements";
import { PalCompanion } from "./companion";
import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
  createFixtureSnapshot,
} from "./fixture-client";
import { PalProvider } from "./provider";
import { PalRewardCelebration } from "./reward-celebration";

test("public surfaces render meaningful status without relying on color", () => {
  const client = createFixturePalClient();
  client.dispatch("daily-log-completed", { activityDay: "2026-05-01" });
  client.dispatch("daily-log-completed", { activityDay: "2026-05-02" });
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

  assert.doesNotMatch(html, />Achievements</);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /4 of 4 eligible days/);
  assert.match(html, /class="pal-badge-progress-ring"/);
  assert.match(html, /stroke-dasharray="100 0"/);
  assert.match(html, /class="pal-badge-progress-label" aria-hidden="true">4\/4</);
  assert.match(html, /Earned/);
  assert.match(html, /Pip, your Pal companion/);
  assert.match(html, /Level 2; 2 school-day rhythm/);
  assert.match(html, /Hello, Pip/);
  assert.match(html, /Story unlocked/);
  assert.ok(snapshot.rewards.some((reward) => reward.title === "A treat for Pip!"));
  assert.match(html, />Continue</);
  assert.match(html, /data-pal-theme="dark"/);
  assert.match(html, /data-pal-density="compact"/);
  assert.match(html, /data-pal-motion="reduced"/);
  assert.match(html, /data-pal-viewport="narrow"/);
  assert.doesNotMatch(html, /aria-label="New Pal reward"/);
});

test("roadmap hides future weeks and renders visible weeks newest first", () => {
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

  assert.match(html, /Week 4/);
  assert.match(html, /Week 1/);
  assert.doesNotMatch(html, /Week 5/);
  assert.doesNotMatch(html, /Future achievements/);
  assert.equal((html.match(/class="pal-week"/g) ?? []).length, 4);
  const weekFour = html.indexOf(">Week 4<");
  const weekThree = html.indexOf(">Week 3<");
  const weekTwo = html.indexOf(">Week 2<");
  const weekOne = html.indexOf(">Week 1<");
  assert.ok(weekFour < weekThree);
  assert.ok(weekThree < weekTwo);
  assert.ok(weekTwo < weekOne);
});

test("roadmap keeps a schema-v1 preterm snapshot renderable", () => {
  const client = createFixturePalClient();
  const snapshot = client.peek();
  snapshot.roadmap.currentWeek = 1;
  for (const week of snapshot.roadmap.weeks) week.status = "future";
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={snapshot}
      scopeKey="fixture-learner"
    >
      <PalAchievements />
    </PalProvider>,
  );

  assert.match(html, /<h3>Week 1<\/h3>/);
});

test("each week has a collectible slot that reveals only earned rewards", () => {
  const client = createFixturePalClient(createFixtureSnapshot(2));
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="concealed-collection-learner"
    >
      <PalAchievements />
    </PalProvider>,
  );

  assert.doesNotMatch(html, />Achievements</);
  assert.doesNotMatch(html, />Your collection</);
  assert.match(html, />Rhythm Builder</);
  assert.match(
    html,
    /class="pal-week-collectible-stack"><header class="pal-week-header"><h3>Week 1<\/h3><\/header><div class="pal-week-collectible" data-unlock-status="earned" aria-label="Week 1 collectible: Mystery Egg, earned" role="img"><span class="pal-week-collectible-art" aria-hidden="true"><img src="\/assets\/world\/reward-mystery-egg-v1\.png"/,
  );
  assert.match(
    html,
    /class="pal-week-collectible-stack"><header class="pal-week-header"><h3>Week 2<\/h3><\/header><div class="pal-week-collectible" data-unlock-status="locked" aria-label="Week 2 collectible locked" role="img">.*?<\/div>/,
  );
  assert.doesNotMatch(html, /<strong aria-hidden="true">Locked<\/strong>/);

  assert.doesNotMatch(html, /Up next/i);
  assert.equal((html.match(/>Mystery Egg</g) ?? []).length, 1);
  assert.doesNotMatch(html, /Unlock Pip first/);
  assert.doesNotMatch(html, /Meet Pip/);
  assert.doesNotMatch(html, /Cozy Cushion/);
  assert.doesNotMatch(html, /Star Sprout/);
  assert.doesNotMatch(html, /Starlight Scarf/);
  assert.doesNotMatch(html, /Moon Nest/);
  assert.doesNotMatch(html, /Scholar Crown/);
  assert.doesNotMatch(html, /assets\/pets\/default\.png/);
  assert.doesNotMatch(html, /reward-cat-cushion-v1\.png/);
  assert.doesNotMatch(html, /reward-star-plant-v1\.png/);
  assert.doesNotMatch(html, /reward-star-scarf-v1\.png/);
  assert.doesNotMatch(html, /reward-moon-bed-v1\.png/);
  assert.doesNotMatch(html, /reward-scholar-crown-v1\.png/);
  assert.doesNotMatch(html, /Reward vault/);
  assert.doesNotMatch(html, /Keep going\. Your collection grows with you\./);
  assert.doesNotMatch(html, /Current title/);
  assert.doesNotMatch(html, />Titles</);
  assert.doesNotMatch(html, /On-Time Pro/);
  assert.doesNotMatch(html, /Quest Keeper/);
  assert.doesNotMatch(html, /Level Leader/);
  assert.doesNotMatch(html, /Semester Legend/);
});

test("roadmap omits the title chip until the learner earns a title", () => {
  const snapshot = createEmptyFixtureSnapshot();
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={snapshot}
      scopeKey="untitled-learner"
    >
      <PalAchievements />
    </PalProvider>,
  );

  assert.equal(snapshot.progression?.currentTitle, undefined);
  assert.doesNotMatch(html, /pal-current-title/);
});

test("companion owns the complete portable cat surface", () => {
  const client = createFixturePalClient();
  client.dispatch("daily-log-completed", { activityDay: "2026-05-01" });
  client.dispatch("daily-log-completed", { activityDay: "2026-05-02" });
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
  assert.doesNotMatch(html, /grass/);
  assert.equal((html.match(/crossorigin="anonymous"/g) ?? []).length, 2);
  assert.match(html, /--pal-companion-cat-height:12rem/);
  assert.doesNotMatch(html, /data-pal-variant=/);
});

test("the companion stays in its mystery egg until week four", () => {
  const client = createFixturePalClient(createFixtureSnapshot(2));
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="early-fixture-learner"
      motion="reduced"
    >
      <PalCompanion />
    </PalProvider>,
  );

  assert.match(html, /data-pal-companion-unlocked="false"/);
  assert.match(html, /reward-mystery-egg-v1\.png/);
  assert.doesNotMatch(html, /assets\/pets\/default\.png/);
  assert.match(html, /Complete Week 4 to meet Pip/);
});

test("the roadmap week prevents a malformed projection from revealing Pip early", () => {
  const snapshot = createFixtureSnapshot(2);
  snapshot.progression!.companionUnlocked = true;
  snapshot.progression!.companionUnlockWeek = 1;
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="malformed-early-fixture-learner"
      motion="reduced"
    >
      <PalCompanion />
    </PalProvider>,
  );

  assert.match(html, /data-pal-companion-unlocked="false"/);
  assert.match(html, /reward-mystery-egg-v1\.png/);
  assert.doesNotMatch(html, /assets\/pets\/default\.png/);
});

test("an incomplete early projection never falls through to the Pip artwork", () => {
  const snapshot = createFixtureSnapshot(2);
  snapshot.progression!.collectibles = snapshot.progression!.collectibles.filter(
    (collectible) => collectible.id !== "mystery-egg-v1",
  );
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="incomplete-early-fixture-learner"
      motion="reduced"
    >
      <PalCompanion />
    </PalProvider>,
  );

  assert.match(html, /data-pal-companion-unlocked="false"/);
  assert.doesNotMatch(html, /reward-mystery-egg-v1\.png/);
  assert.doesNotMatch(html, /assets\/pets\/default\.png/);
});

test("a locked mystery egg never leaks into the early companion surface", () => {
  const snapshot = createFixtureSnapshot(2);
  const egg = snapshot.progression!.collectibles.find(
    (collectible) => collectible.id === "mystery-egg-v1",
  );
  assert.ok(egg);
  egg.status = "locked";
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="locked-egg-fixture-learner"
      motion="reduced"
    >
      <PalCompanion />
    </PalProvider>,
  );

  assert.match(html, /data-pal-companion-unlocked="false"/);
  assert.doesNotMatch(html, /reward-mystery-egg-v1\.png/);
  assert.doesNotMatch(html, /assets\/pets\/default\.png/);
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

test("story reveal presents headline, collectible, story, then title", () => {
  const client = createFixturePalClient(createFixtureSnapshot(3));
  client.dispatch("daily-log-completed", { activityDay: "2026-05-01" });
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="story-reveal-learner"
      motion="reduced"
    >
      <PalRewardCelebration />
    </PalProvider>,
  );

  const celebration = html.slice(html.indexOf('class="pal-celebration"'));
  const headline = celebration.indexOf("Keep the light on");
  const artwork = celebration.indexOf("reward-warming-lantern-v1.png");
  const collectible = celebration.indexOf("Warming Lantern");
  const story = celebration.indexOf("The coldest night arrived");
  const title = celebration.indexOf("Gentle Keeper");
  assert.ok(headline >= 0);
  assert.ok(headline < artwork);
  assert.ok(artwork < collectible);
  assert.ok(collectible < story);
  assert.ok(story < title);
  assert.match(html, /Story unlocked/);
  assert.match(html, /New title/);
});
