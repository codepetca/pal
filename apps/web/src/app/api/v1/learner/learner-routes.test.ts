import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import {
  getDb,
  getPool,
  learnerRewardGrants,
  storyPlanChapters,
  storyPlans,
} from "@pal/db";
import { and, eq } from "drizzle-orm";
import {
  getOrCreateLearnerIdentity,
  processEventInDb,
  resetLearnerInDb,
} from "@/lib/db-learner";
import { resolveIntegration } from "@/lib/integration-auth";
import { mintPalReadToken } from "@/lib/read-token";
import {
  HOME_STORY_ID,
  HOME_STORY_VERSION,
  STORY_REGISTRY,
} from "@/lib/story-catalog";
import { runStoryGrantWorker } from "@/lib/story-grant-worker";
import { GET as getSnapshot, OPTIONS as snapshotOptions } from "./snapshot/route";
import {
  OPTIONS as rewardOptions,
  POST as acknowledgeReward,
} from "./rewards/[rewardId]/seen/route";
import {
  OPTIONS as loadoutOptions,
  POST as setRewardLoadout,
} from "./reward-loadout/route";

const secret = "learner-routes-sandbox-secret-at-least-32-characters";
const pikaSecret = "learner-routes-pika-secret-at-least-32-characters";
const signingSecret = "learner-routes-signing-secret-at-least-32-characters";
const allowedOrigin = "https://pika.example.test";
process.env.SANDBOX_INTEGRATION_SECRET = secret;
process.env.PAL_INTEGRATION_SECRET = pikaSecret;
process.env.PAL_READ_TOKEN_SIGNING_SECRET = signingSecret;
process.env.PAL_ALLOWED_WIDGET_ORIGINS = allowedOrigin;

let openedDatabase = false;

function request(
  path: string,
  token?: string,
  origin?: string,
  method = "GET",
): NextRequest {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (origin) headers.set("Origin", origin);
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

function loadoutRequest(
  token: string,
  body: { slot: "companion" | "wallpaper"; rewardGrantId: string | null },
): NextRequest {
  return new NextRequest("http://localhost/api/v1/learner/reward-loadout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: allowedOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("rejects missing authentication and unapproved widget origins", async () => {
  const missing = await getSnapshot(request("/api/v1/learner/snapshot"));
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("cache-control"), "no-store");

  const disallowed = await getSnapshot(
    request(
      "/api/v1/learner/snapshot",
      "untrusted-token",
      "https://attacker.example",
    ),
  );
  assert.equal(disallowed.status, 403);
  assert.equal(disallowed.headers.get("cache-control"), "no-store");
  assert.equal(disallowed.headers.get("vary"), "Origin");
  assert.equal(disallowed.headers.get("access-control-allow-origin"), null);

  const deniedRewardPreflight = await rewardOptions(
    request(
      "/api/v1/learner/rewards/not-a-reward/seen",
      undefined,
      "https://attacker.example",
      "OPTIONS",
    ),
  );
  assert.equal(deniedRewardPreflight.status, 403);
  assert.equal(deniedRewardPreflight.headers.get("cache-control"), "no-store");
  assert.equal(deniedRewardPreflight.headers.get("vary"), "Origin");
  assert.equal(
    deniedRewardPreflight.headers.get("access-control-allow-origin"),
    null,
  );

  const deniedReward = await acknowledgeReward(
    request(
      "/api/v1/learner/rewards/not-a-reward/seen",
      "untrusted-token",
      "https://attacker.example",
      "POST",
    ),
    { params: Promise.resolve({ rewardId: "not-a-reward" }) },
  );
  assert.equal(deniedReward.status, 403);
  assert.equal(deniedReward.headers.get("cache-control"), "no-store");
  assert.equal(deniedReward.headers.get("vary"), "Origin");

  const unauthenticatedInvalidReward = await acknowledgeReward(
    request(
      "/api/v1/learner/rewards/not-a-reward/seen",
      "untrusted-token",
      allowedOrigin,
      "POST",
    ),
    { params: Promise.resolve({ rewardId: "not-a-reward" }) },
  );
  assert.equal(unauthenticatedInvalidReward.status, 401);

  const preflight = await snapshotOptions(
    request("/api/v1/learner/snapshot", undefined, allowedOrigin, "OPTIONS"),
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.match(
    preflight.headers.get("access-control-allow-headers") ?? "",
    /Authorization/,
  );
});

test("loadout writes require an allowed origin, equip scope, and bounded valid body", async () => {
  const denied = await setRewardLoadout(
    request(
      "/api/v1/learner/reward-loadout",
      "untrusted-token",
      "https://attacker.example",
      "POST",
    ),
  );
  assert.equal(denied.status, 403);

  const unauthenticated = await setRewardLoadout(
    request(
      "/api/v1/learner/reward-loadout",
      undefined,
      allowedOrigin,
      "POST",
    ),
  );
  assert.equal(unauthenticated.status, 401);

  const preflight = await loadoutOptions(
    request(
      "/api/v1/learner/reward-loadout",
      undefined,
      allowedOrigin,
      "OPTIONS",
    ),
  );
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);

  const { token } = await mintPalReadToken({ learnerId: "00000000-0000-4000-8000-000000000001", integrationId: "00000000-0000-4000-8000-000000000002" });
  const invalid = new NextRequest("http://localhost/api/v1/learner/reward-loadout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: allowedOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slot: "keepsake", rewardGrantId: "not-a-uuid" }),
  });
  const invalidResponse = await setRewardLoadout(invalid);
  assert.equal(invalidResponse.status, 422);
  assert.equal((await invalidResponse.json()).error, "invalid_request");

  const oversized = new NextRequest("http://localhost/api/v1/learner/reward-loadout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: allowedOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      slot: "wallpaper",
      rewardGrantId: null,
      padding: "x".repeat(2_048),
    }),
  });
  oversized.headers.delete("content-length");
  const oversizedResponse = await setRewardLoadout(oversized);
  assert.equal(oversizedResponse.status, 422);
  assert.equal((await oversizedResponse.json()).error, "invalid_request");

  let chunksProduced = 0;
  let streamCancelled = false;
  const chunkedBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksProduced += 1;
      controller.enqueue(new Uint8Array(1_024));
      if (chunksProduced === 100) controller.close();
    },
    cancel() {
      streamCancelled = true;
    },
  });
  const chunked = new NextRequest(
    "http://localhost/api/v1/learner/reward-loadout",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: allowedOrigin,
        "Content-Type": "application/json",
      },
      body: chunkedBody,
      duplex: "half",
    } as never,
  );
  const chunkedResponse = await setRewardLoadout(chunked);
  assert.equal(chunkedResponse.status, 422);
  assert.equal((await chunkedResponse.json()).error, "invalid_request");
  assert.equal(streamCancelled, true);
  assert.ok(chunksProduced < 100);
});

test(
  "serves an authenticated snapshot and acknowledges its reward idempotently",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `routes-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        {
          event_type: "learning_item.completed",
          occurred_at: new Date().toISOString(),
          metadata: {
            item_token: `item-${crypto.randomUUID()}`,
            kind: "assignment",
            period_key: `period-${crypto.randomUUID()}`,
            timing: "on_time",
          },
        },
        `routes-${crypto.randomUUID()}`,
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const { token } = await mintPalReadToken({
        learnerId,
        integrationId: integration.id,
      });

      const response = await getSnapshot(
        request("/api/v1/learner/snapshot", token, allowedOrigin),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
      const snapshot = (await response.json()) as {
        schemaVersion: number;
        rewards: Array<{ id: string }>;
      };
      assert.equal(snapshot.schemaVersion, 1);
      assert.equal(snapshot.rewards.length, 2);

      for (const reward of snapshot.rewards) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const acknowledged = await acknowledgeReward(
            request(
              `/api/v1/learner/rewards/${reward.id}/seen`,
              token,
              allowedOrigin,
              "POST",
            ),
            { params: Promise.resolve({ rewardId: reward.id }) },
          );
          assert.equal(acknowledged.status, 204);
        }
      }

      const afterAck = await getSnapshot(
        request("/api/v1/learner/snapshot", token, allowedOrigin),
      );
      assert.equal(afterAck.status, 200);
      assert.equal(
        ((await afterAck.json()) as { rewards: unknown[] }).rewards.length,
        0,
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "snapshot capability versions safely shape a persisted capped Home plan",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `routes-home-compat-${crypto.randomUUID()}`;
    const termKey = `routes-home-compat-term-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const home = STORY_REGISTRY.createPlan(20, {
        storyId: HOME_STORY_ID,
        version: HOME_STORY_VERSION,
      });
      await getDb().transaction(async (tx) => {
        const [persisted] = await tx.insert(storyPlans).values({
          learnerId,
          termKey,
          termStartDay: "2026-08-17",
          storyId: home.storyId,
          storyVersion: home.version,
          totalPeriods: home.totalPeriods,
        }).returning({ id: storyPlans.id });
        await tx.insert(storyPlanChapters).values(
          home.chapters.map((chapter) => ({
            storyPlanId: persisted!.id,
            learnerId,
            periodNumber: chapter.roadmapWeek,
            chapterId: chapter.id,
          })),
        );
      });
      for (const week of [7, 8]) {
        const configured = await processEventInDb(
          integration.id,
          externalLearnerId,
          {
            event_type: "daily_log_week.configured",
            occurred_at: week === 7
              ? "2026-09-28T12:00:00.000Z"
              : "2026-10-05T12:00:00.000Z",
            metadata: {
              period_key: `routes-home-period-${week}-${crypto.randomUUID()}`,
              config_version: 1,
              period_status: "open",
              eligible_days: 1,
              term_token: termKey,
              term_start_day: "2026-08-17",
              term_end_day: "2027-01-01",
              term_timezone: "America/Toronto",
              term_week_count: 20,
              week_start_day: week === 7 ? "2026-09-28" : "2026-10-05",
              week_index: week,
            },
          },
          `routes-home-${week}-${crypto.randomUUID()}`,
          { storyGrantAsOf: new Date("2026-09-28T00:00:00.000Z") },
        );
        assert.equal(configured.status, "processed");
      }
      const worker = await runStoryGrantWorker({
        asOf: new Date("2026-10-10T12:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(worker.grants, 2);
      const { token } = await mintPalReadToken({
        learnerId,
        integrationId: integration.id,
      });

      const legacyResponse = await getSnapshot(
        request("/api/v1/learner/snapshot", token, allowedOrigin),
      );
      const legacy = (await legacyResponse.json()) as {
        progression?: { collectibles: Array<{ status: string; kind?: string }> };
        rewards: Array<{ kind?: string }>;
        rewardLoadout?: unknown;
      };
      assert.equal(legacy.progression?.collectibles.length, 20);
      assert.equal(
        legacy.progression?.collectibles.some(
          (collectible) => collectible.status === "earned",
        ),
        false,
      );
      assert.equal(legacy.rewards.some((reward) => reward.kind === "story"), false);
      assert.equal(legacy.rewardLoadout, undefined);

      const capableRequest = request(
        "/api/v1/learner/snapshot",
        token,
        allowedOrigin,
      );
      capableRequest.headers.set("X-Pal-Collectible-Finish", "1");
      const capableResponse = await getSnapshot(capableRequest);
      const capable = (await capableResponse.json()) as {
        progression?: {
          collectibles: Array<{ status: string; finish?: string; kind?: string }>;
        };
        rewards: Array<{ kind?: string; collectibleFinish?: string }>;
      };
      assert.equal(
        capable.progression?.collectibles.some(
          (collectible) =>
            collectible.status === "earned" && collectible.finish === "sketch",
        ),
        true,
      );
      assert.equal(capable.progression?.collectibles.length, 20);
      assert.deepEqual(
        capable.progression?.collectibles
          .filter((collectible) => collectible.status === "earned")
          .map((collectible) => collectible.kind),
        ["cosmetic", "room"],
      );
      assert.equal(
        capable.rewards.some(
          (reward) =>
            reward.kind === "story" && reward.collectibleFinish === "sketch",
        ),
        true,
      );

      const currentRequest = request(
        "/api/v1/learner/snapshot",
        token,
        allowedOrigin,
      );
      currentRequest.headers.set("X-Pal-Collectible-Finish", "2");
      const currentResponse = await getSnapshot(currentRequest);
      const current = (await currentResponse.json()) as {
        progression?: {
          collectibles: Array<{ status: string; finish?: string; kind?: string }>;
        };
        rewardLoadout?: unknown;
      };
      assert.equal(current.progression?.collectibles.length, 16);
      assert.deepEqual(
        current.progression?.collectibles
          .filter((collectible) => collectible.status === "earned")
          .map((collectible) => collectible.kind),
        ["keepsake", "wallpaper"],
      );
      assert.equal(
        current.progression?.collectibles.every(
          (collectible) =>
            collectible.status !== "earned" || collectible.finish === "sketch",
        ),
        true,
      );
      assert.ok(current.rewardLoadout);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "does not serve a learner through a token naming another integration",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `route-scope-${crypto.randomUUID()}`;
    const sandbox = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const pika = await resolveIntegration({
      slug: "pika",
      name: "Pika",
      secret: pikaSecret,
    });
    try {
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        sandbox.id,
        externalLearnerId,
      );
      const { token } = await mintPalReadToken({
        learnerId,
        integrationId: pika.id,
      });
      const response = await getSnapshot(
        request("/api/v1/learner/snapshot", token, allowedOrigin),
      );
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, "learner_not_found");
    } finally {
      await resetLearnerInDb(sandbox.id, externalLearnerId);
      await resetLearnerInDb(pika.id, externalLearnerId);
    }
  },
);

test(
  "equips and clears an owned wallpaper through the learner-scoped API",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `route-loadout-${crypto.randomUUID()}`;
    const termKey = `route-loadout-term-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      let learnerId = "";
      for (let week = 1; week <= 8; week += 1) {
        const weekStart = new Date(Date.UTC(2026, 4, 4 + ((week - 1) * 7)));
        const day = weekStart.toISOString().slice(0, 10);
        const periodKey = `route-loadout-period-${week}-${crypto.randomUUID()}`;
        const configured = await processEventInDb(
          integration.id,
          externalLearnerId,
          {
            event_type: "daily_log_week.configured",
            occurred_at: `${day}T12:00:00.000Z`,
            metadata: {
              period_key: periodKey,
              config_version: 1,
              period_status: "open",
              eligible_days: 1,
              term_token: termKey,
              term_start_day: "2026-05-04",
              term_end_day: "2026-08-21",
              term_timezone: "America/Toronto",
              term_week_count: 16,
              week_start_day: day,
              week_index: week,
            },
          },
          `route-loadout-config-${week}-${crypto.randomUUID()}`,
          { storyGrantAsOf: weekStart },
        );
        assert.equal(configured.status, "processed");
        learnerId ||= await getOrCreateLearnerIdentity(
          getDb(),
          integration.id,
          externalLearnerId,
        );
        const worker = await runStoryGrantWorker({
          asOf: new Date(weekStart.getTime() + (5 * 86_400_000) + 43_200_000),
          onlyLearnerIds: [learnerId],
        });
        assert.equal(worker.grants, 1);
      }

      const { token } = await mintPalReadToken({
        learnerId,
        integrationId: integration.id,
      });
      const snapshotRequest = () => {
        const next = request("/api/v1/learner/snapshot", token, allowedOrigin);
        next.headers.set("X-Pal-Collectible-Finish", "2");
        return next;
      };
      const before = (await (await getSnapshot(snapshotRequest())).json()) as {
        rewardLoadout: {
          wallpaper: {
            equippedGrantId?: string;
            options: Array<{ grantId: string; rewardId: string }>;
          };
        };
      };
      const wallpaper = before.rewardLoadout.wallpaper.options.find(
        (option) => option.rewardId === "courtyard-afternoons-v1",
      );
      assert.ok(wallpaper);
      assert.equal(before.rewardLoadout.wallpaper.equippedGrantId, undefined);

      const equipped = await setRewardLoadout(loadoutRequest(token, {
        slot: "wallpaper",
        rewardGrantId: wallpaper.grantId,
      }));
      assert.equal(equipped.status, 204);
      const afterEquip = (await (await getSnapshot(snapshotRequest())).json()) as typeof before;
      assert.equal(
        afterEquip.rewardLoadout.wallpaper.equippedGrantId,
        wallpaper.grantId,
      );

      const wrongSlot = await setRewardLoadout(loadoutRequest(token, {
        slot: "companion",
        rewardGrantId: wallpaper.grantId,
      }));
      assert.equal(wrongSlot.status, 422);
      assert.equal((await wrongSlot.json()).error, "reward_not_usable");

      const [concealedGrant] = await getDb()
        .select({ id: learnerRewardGrants.id })
        .from(learnerRewardGrants)
        .innerJoin(
          storyPlanChapters,
          eq(learnerRewardGrants.storyPlanChapterId, storyPlanChapters.id),
        )
        .where(and(
          eq(learnerRewardGrants.learnerId, learnerId),
          eq(storyPlanChapters.chapterId, "dusty-discovery"),
        ))
        .limit(1);
      assert.ok(concealedGrant);
      const concealed = await setRewardLoadout(loadoutRequest(token, {
        slot: "companion",
        rewardGrantId: concealedGrant.id,
      }));
      assert.equal(concealed.status, 422);
      assert.equal((await concealed.json()).error, "reward_not_usable");

      const cleared = await setRewardLoadout(loadoutRequest(token, {
        slot: "wallpaper",
        rewardGrantId: null,
      }));
      assert.equal(cleared.status, 204);
      const afterClear = (await (await getSnapshot(snapshotRequest())).json()) as typeof before;
      assert.equal(afterClear.rewardLoadout.wallpaper.equippedGrantId, undefined);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

after(async () => {
  if (openedDatabase) await getPool().end();
});
