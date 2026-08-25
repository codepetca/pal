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
  assert.match(html, /Mystery companion/);
  assert.match(html, /Weekly Rhythm/);
  assert.match(html, /data-pal-reward-kind="achievement"/);
  assert.doesNotMatch(html, /Achievement earned/);
  assert.match(html, /badge-checkin-7-day-v1\.png/);
  assert.ok(
    snapshot.rewards.some(
      (reward) =>
        reward.achievement !== undefined &&
        reward.achievement.key === "weekly-rhythm",
    ),
  );
  assert.match(html, />Continue</);
  assert.match(html, /data-pal-theme="dark"/);
  assert.match(html, /data-pal-density="compact"/);
  assert.match(html, /data-pal-motion="reduced"/);
  assert.match(html, /data-pal-viewport="narrow"/);
  assert.doesNotMatch(html, /aria-label="New Pal reward"/);
});

test("modal celebration uses backdrop dismissal without a continue button", () => {
  const client = createFixturePalClient();
  client.dispatch("item-opened-early", { itemToken: "modal-celebration-item" });
  const snapshot = client.peek();
  const html = renderToStaticMarkup(
    <PalProvider client={client} initialSnapshot={snapshot} scopeKey="modal-reward">
      <PalRewardCelebration effect="fireworks" modal />
    </PalProvider>,
  );

  assert.match(html, /class="pal-celebration-backdrop"/);
  assert.match(html, /data-pal-effect="fireworks"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /class="pal-celebration-fireworks"/);
  assert.equal((html.match(/<span><\/span>/g) ?? []).length, 24);
  assert.doesNotMatch(html, />Continue<\/button>/);
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
  const snapshot = createFixtureSnapshot(2);
  snapshot.progression!.collectibles[0] = {
    id: "earned-week-one",
    chapterId: "earned-chapter",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Earned",
    title: "Mystery Egg",
    description: "An earned keepsake.",
    kind: "room",
    finish: "sketch",
    assetUrl: "/assets/world/reward-mystery-egg-v1.png",
  };
  snapshot.progression!.currentTitle = "Rhythm Builder";
  const client = createFixturePalClient(snapshot);
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
    /class="pal-week-collectible-stack"><header class="pal-week-header"><h3>Week 1<\/h3><\/header><div class="pal-week-collectible" data-unlock-status="earned" data-collectible-finish="sketch" aria-label="Week 1 collectible: Mystery Egg, storybook sketch" role="img"><span class="pal-week-collectible-art" aria-hidden="true"><img src="\/assets\/world\/reward-mystery-egg-v1\.png"/,
  );
  assert.match(
    html,
    /class="pal-week-collectible-stack"><header class="pal-week-header"><h3>Week 2<\/h3><\/header><div class="pal-week-collectible" data-unlock-status="locked" data-collectible-finish="color" aria-label="Week 2 collectible locked" role="img">.*?<\/div>/,
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

test("an earned week shows its story beside the week, collapsed to the headline", () => {
  const snapshot = createFixtureSnapshot(2);
  snapshot.progression!.collectibles[0] = {
    id: "earned-week-one",
    chapterId: "egg-arrives",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Earned",
    title: "Mystery Egg",
    description: "An earned keepsake.",
    revealHeadline: "Something Found You",
    storyCopy: "A heavy storm passed over the town during the night.",
    kind: "room",
    finish: "color",
    assetUrl: "/assets/world/reward-mystery-egg-v1.png",
  };
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="story-week-learner"
    >
      <PalAchievements />
    </PalProvider>,
  );

  assert.match(html, /class="pal-week-story"/);
  assert.match(html, />Something Found You</);
  // The passage ships in the markup but stays hidden until the reader opens it,
  // so a long trail is not a wall of text.
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /class="pal-week-story-panel" hidden=""/);
  assert.match(html, /A heavy storm passed over the town during the night\./);
});

test("a week with no earned collectible has no story bubble", () => {
  const snapshot = createFixtureSnapshot(2);
  snapshot.progression!.collectibles = snapshot.progression!.collectibles.map(
    (collectible) => ({ ...collectible, status: "locked" as const }),
  );
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="locked-story-learner"
    >
      <PalAchievements />
    </PalProvider>,
  );

  assert.doesNotMatch(html, /class="pal-week-story"/);
});

test("story celebration carries the chapter's passage alongside the collectible", () => {
  const snapshot = createFixtureSnapshot(1, 6);
  snapshot.rewards = [{
    id: "story-sketch",
    kind: "story",
    title: "A new chapter",
    description: "The egg waits beside the lamp.",
    collectibleTitle: "Mystery Egg",
    collectibleFinish: "sketch",
    assetUrl: "/assets/world/reward-mystery-egg-v1.png",
  }];
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider client={client} initialSnapshot={snapshot} scopeKey="sketch-reward">
      <PalRewardCelebration />
    </PalProvider>,
  );
  assert.match(html, /data-pal-reward-kind="story"/);
  assert.match(html, />Mystery Egg</);
  assert.match(html, /reward-mystery-egg-v1\.png/);
  // The reveal happens here, so the chapter headline and passage ride along
  // with the collectible rather than waiting in the trail.
  assert.match(html, />A new chapter</);
  assert.match(html, /The egg waits beside the lamp/);
  assert.doesNotMatch(html, /Storybook sketch/);
});

test("achievement celebration centers its earned badge without explanatory copy", () => {
  const client = createFixturePalClient();
  client.dispatch("item-opened-early", { itemToken: "celebration-item" });
  const snapshot = client.peek();
  const reward = snapshot.rewards.find(
    (candidate) => candidate.achievement?.key === "ready-early",
  );
  assert.ok(reward);
  snapshot.rewards = [reward];

  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={snapshot}
      scopeKey="achievement-celebration"
    >
      <PalRewardCelebration />
    </PalProvider>,
  );

  assert.match(html, /data-pal-reward-kind="achievement"/);
  assert.match(html, />Ready Early<\/h2>/);
  assert.match(html, /badge-ready-early-v1\.png/);
  assert.doesNotMatch(html, /Opened a learning item soon after it was released/);
  assert.doesNotMatch(html, /Achievement earned/);
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
  snapshot.progression!.companionReveal = {
    status: "earned",
    assetUrl: "https://pal.example/assets/pets/default.png",
  };
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
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /assets\/pets\/default\.png/);
  assert.match(html, /Keep building your Weekly Rhythm/);
});

test("the canonical projection can name a different companion", () => {
  const snapshot = createFixtureSnapshot(2);
  snapshot.companion.name = "Nova";
  const reveal = snapshot.progression!.companionReveal;
  assert.equal(reveal.status, "locked");
  snapshot.progression!.companionReveal = {
    ...reveal,
    label: "Mystery companion. Complete Week 4 to meet Nova.",
  };
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="nova-fixture-learner"
      motion="reduced"
    >
      <PalCompanion />
    </PalProvider>,
  );

  assert.match(html, /Complete Week 4 to meet Nova/);
  assert.doesNotMatch(html, /meet Pip/);
});

test("the companion renders only the canonical reveal decision", () => {
  const snapshot = createFixtureSnapshot(2);
  snapshot.progression!.companionReveal = {
    status: "earned",
    assetUrl: "/assets/pets/default.png",
  };
  const client = createFixturePalClient(snapshot);
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="canonical-reveal-fixture-learner"
      motion="reduced"
    >
      <PalCompanion />
    </PalProvider>,
  );

  assert.match(html, /data-pal-companion-unlocked="true"/);
  assert.match(html, /assets\/pets\/default\.png/);
  assert.doesNotMatch(html, /reward-mystery-egg-v1\.png/);
});

test("the companion does not rebuild its display from collectible lookups", () => {
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
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /assets\/pets\/default\.png/);
});

test("a locked reveal without earned mystery art renders no image", () => {
  const snapshot = createFixtureSnapshot(2);
  snapshot.progression!.companionReveal = {
    status: "locked",
    label: "Mystery companion.",
  };
  snapshot.companion.assetUrl = "/assets/pets/default.png";
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
  client.dispatch("on-time-finish", { itemToken: "host-managed-item" });
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

test("host-managed modal content retains its acknowledgement action", () => {
  const client = createFixturePalClient();
  client.dispatch("on-time-finish", { itemToken: "host-managed-modal-item" });
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="host-managed-modal-learner"
    >
      <PalRewardCelebration hostManaged modal />
    </PalProvider>,
  );

  assert.match(html, />Continue<\/button>/);
  assert.doesNotMatch(html, /pal-celebration-backdrop/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.doesNotMatch(html, /aria-modal=/);
});

test("host-managed modal content can leave dismissal to the host", () => {
  const client = createFixturePalClient();
  client.dispatch("on-time-finish", { itemToken: "host-dismissed-modal-item" });
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="host-dismissed-modal-learner"
    >
      <PalRewardCelebration hostManaged showDismissAction={false} />
    </PalProvider>,
  );

  assert.doesNotMatch(html, />Continue<\/button>/);
  assert.doesNotMatch(html, /pal-celebration-backdrop/);
  assert.doesNotMatch(html, /role="dialog"/);
});

test("standalone content always retains a dismissal action", () => {
  const client = createFixturePalClient();
  client.dispatch("on-time-finish", { itemToken: "standalone-dismissal-item" });
  const html = renderToStaticMarkup(
    <PalProvider
      client={client}
      initialSnapshot={client.peek()}
      scopeKey="standalone-dismissal-learner"
    >
      <PalRewardCelebration showDismissAction={false} />
    </PalProvider>,
  );

  assert.match(html, />Continue<\/button>/);
});

test("a title reward shows only the earned title and its action", () => {
  const snapshot = createFixtureSnapshot(3);
  snapshot.rewards.unshift({
    id: "story-reveal",
    kind: "story",
    title: "Keep the light on",
    description: "The coldest night arrived.",
    collectibleTitle: "Warming Lantern",
    assetUrl: "/assets/world/reward-warming-lantern-v1.png",
    titleAward: "Gentle Keeper",
  });
  const client = createFixturePalClient(snapshot);
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
  assert.match(celebration, /data-pal-reward-kind="title"/);
  assert.match(celebration, /<h2[^>]*>Gentle Keeper<\/h2>/);
  assert.match(celebration, />Continue<\/button>/);
  assert.doesNotMatch(celebration, /Keep the light on/);
  assert.doesNotMatch(celebration, /reward-warming-lantern-v1\.png/);
  assert.doesNotMatch(celebration, /Warming Lantern/);
  assert.doesNotMatch(celebration, /The coldest night arrived/);
  assert.doesNotMatch(celebration, /Story unlocked/);
  assert.doesNotMatch(celebration, /New title/);
});
