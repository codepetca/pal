import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import {
  buildDiscordPrPayload,
  sendDiscordPrNotification,
} from "./notify-discord-pr.mjs";

describe("Discord PR notification", () => {
  it("posts a one-line linked PR title without an embed", () => {
    assert.deepEqual(
      buildDiscordPrPayload(
        githubEvent({ title: "Make Discord PR updates concise" }),
      ),
      {
        content:
          "🔀 [pal #99: Make Discord PR updates concise](https://github.com/codepetca/pal/pull/99)",
        allowed_mentions: { parse: [] },
        flags: 4,
      },
    );
  });

  it("keeps untrusted titles on one line and neutralizes Discord formatting", () => {
    const payload = buildDiscordPrPayload(
      githubEvent({ title: "  Fix   @everyone\n**right now**  " }),
    );

    assert.equal(
      payload.content,
      "🔀 [pal #99: Fix @everyone \\*\\*right now\\*\\*](https://github.com/codepetca/pal/pull/99)",
    );
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(payload.content.includes("\n"), false);
  });

  it("caps long PR titles", () => {
    const payload = buildDiscordPrPayload(githubEvent({ title: "a".repeat(140) }));

    assert.equal(payload.content.includes(`${"a".repeat(119)}…`), true);
    assert.equal(payload.content.includes("a".repeat(120)), false);
  });

  it("rejects links outside GitHub", () => {
    assert.throws(
      () =>
        buildDiscordPrPayload(
          githubEvent({ html_url: "https://example.com/lookalike" }),
        ),
      /invalid pull request URL/u,
    );
  });

  it("waits for Discord to confirm that the message was saved", async () => {
    const fetchImpl = mock.fn(async () => Response.json({ id: "message-id" }));

    await sendDiscordPrNotification({
      event: githubEvent(),
      webhookUrl: "https://discord.com/api/webhooks/123456789/secret-token",
      fetchImpl,
    });

    assert.equal(fetchImpl.mock.calls.length, 1);
    assert.equal(
      fetchImpl.mock.calls[0].arguments[0],
      "https://discord.com/api/webhooks/123456789/secret-token?wait=true",
    );
    assert.equal(
      fetchImpl.mock.calls[0].arguments[1].body,
      JSON.stringify(buildDiscordPrPayload(githubEvent())),
    );
  });

  it("fails when Discord does not confirm a saved message", async () => {
    const fetchImpl = mock.fn(async () => new Response(null, { status: 204 }));

    await assert.rejects(
      sendDiscordPrNotification({
        event: githubEvent(),
        webhookUrl: "https://discord.com/api/webhooks/123456789/secret-token",
        fetchImpl,
      }),
      /Discord webhook returned HTTP 204/u,
    );
  });

  it("rejects webhook destinations outside Discord", async () => {
    await assert.rejects(
      sendDiscordPrNotification({
        event: githubEvent(),
        webhookUrl: "https://example.com/api/webhooks/123456789/secret-token",
      }),
      /DISCORD_PR_WEBHOOK_URL is invalid/u,
    );
  });
});

function githubEvent(
  pullRequest = {},
) {
  return {
    repository: { name: "pal" },
    pull_request: {
      html_url: "https://github.com/codepetca/pal/pull/99",
      number: 99,
      title: "A concise title",
      ...pullRequest,
    },
  };
}
