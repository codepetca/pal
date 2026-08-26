import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_TITLE_LENGTH = 120;
const SUPPRESS_EMBEDS = 1 << 2;

export function buildDiscordPrPayload(event) {
  const pullRequest = event?.pull_request;
  const repository = event?.repository;

  if (!pullRequest || !repository) {
    throw new Error("GitHub event is missing pull request or repository data.");
  }

  const repoName = cleanText(repository.name, "repository");
  const number = Number(pullRequest.number);
  const url = validatePullRequestUrl(pullRequest.html_url);
  const title = escapeDiscordMarkdown(
    truncate(cleanText(pullRequest.title, "pull request title"), MAX_TITLE_LENGTH),
  );

  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("GitHub event has an invalid pull request number.");
  }

  return {
    content: `🔀 [${escapeDiscordMarkdown(repoName)} #${number}: ${title}](${url})`,
    allowed_mentions: { parse: [] },
    flags: SUPPRESS_EMBEDS,
  };
}

export async function sendDiscordPrNotification({
  event,
  webhookUrl,
  fetchImpl = fetch,
}) {
  const url = validateDiscordWebhookUrl(webhookUrl);
  url.searchParams.set("wait", "true");

  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDiscordPrPayload(event)),
  });

  if (response.status !== 200) {
    throw new Error(`Discord webhook returned HTTP ${response.status}.`);
  }
}

function cleanText(value, label) {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";

  if (!text) {
    throw new Error(`GitHub event has no ${label}.`);
  }

  return text;
}

function truncate(value, maxLength) {
  const characters = Array.from(value);

  if (characters.length <= maxLength) {
    return value;
  }

  return `${characters.slice(0, maxLength - 1).join("")}…`;
}

function escapeDiscordMarkdown(value) {
  return value.replace(/([\\`*_{}\[\]()<>#+\-.!|~])/gu, "\\$1");
}

function validatePullRequestUrl(value) {
  const url = new URL(value);

  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("GitHub event has an invalid pull request URL.");
  }

  return url.toString();
}

function validateDiscordWebhookUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("DISCORD_PR_WEBHOOK_URL is invalid.");
  }

  const webhookPath = /^\/api\/webhooks\/\d+\/[a-zA-Z0-9._-]+$/u;

  if (
    url.protocol !== "https:" ||
    url.hostname !== "discord.com" ||
    url.username ||
    url.password ||
    !webhookPath.test(url.pathname)
  ) {
    throw new Error("DISCORD_PR_WEBHOOK_URL is invalid.");
  }

  url.hash = "";
  return url;
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const webhookUrl = process.env.DISCORD_PR_WEBHOOK_URL;

  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set.");
  }

  if (!webhookUrl) {
    throw new Error("DISCORD_PR_WEBHOOK_URL is not set.");
  }

  const event = JSON.parse(await readFile(eventPath, "utf8"));
  await sendDiscordPrNotification({ event, webhookUrl });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
