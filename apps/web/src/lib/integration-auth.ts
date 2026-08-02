import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, integrations } from "@pal/db";
import type { Db } from "@pal/db";
import { v1 } from "@pal/contract";

const MINIMUM_SECRET_LENGTH = 32;

export interface ConfiguredIntegration {
  slug: "pika" | "sandbox";
  name: string;
  secret: string;
}

export interface AuthenticatedIntegration {
  id: string;
  slug: ConfiguredIntegration["slug"];
  allowedEventTypes: readonly string[];
}

function secretHash(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function configuredIntegration(
  slug: ConfiguredIntegration["slug"],
  name: string,
  secret: string | undefined,
): ConfiguredIntegration | null {
  const normalized = secret?.trim();
  if (!normalized) return null;
  if (normalized.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`${slug} integration secret must be at least 32 characters`);
  }
  return { slug, name, secret: normalized };
}

function configuredIntegrations(): ConfiguredIntegration[] {
  const candidates = [
    configuredIntegration("pika", "Pika", process.env.PAL_INTEGRATION_SECRET),
    configuredIntegration(
      "sandbox",
      "Sandbox",
      process.env.SANDBOX_INTEGRATION_SECRET,
    ),
  ].filter((candidate): candidate is ConfiguredIntegration => candidate !== null);

  if (
    candidates.length === 2 &&
    timingSafeEqual(
      secretHash(candidates[0].secret),
      secretHash(candidates[1].secret),
    )
  ) {
    throw new Error("Pika and sandbox integration secrets must be distinct");
  }
  return candidates;
}

/**
 * Authenticates a configured integration without opening the database. This
 * lets routes reject unauthorized or malformed requests before persistence.
 */
export function identifyIntegration(
  authorization: string | null,
): ConfiguredIntegration | null {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
  if (!match || match[1].length > 4_096) return null;

  const presentedHash = secretHash(match[1]);
  let selected: ConfiguredIntegration | null = null;
  for (const candidate of configuredIntegrations()) {
    if (timingSafeEqual(presentedHash, secretHash(candidate.secret))) {
      selected = candidate;
    }
  }
  return selected;
}

/**
 * Resolves a successfully authenticated environment-backed integration to its
 * durable tenant row. A changed environment secret deliberately rotates the
 * stored hash; plaintext credentials are never persisted.
 */
export async function resolveIntegration(
  configured: ConfiguredIntegration,
  db: Db = getDb(),
): Promise<AuthenticatedIntegration> {
  const hash = secretHash(configured.secret).toString("hex");
  const [existing] = await db
    .select({
      id: integrations.id,
      secretHash: integrations.secretHash,
      allowedEventTypes: integrations.allowedEventTypes,
    })
    .from(integrations)
    .where(eq(integrations.slug, configured.slug))
    .limit(1);

  if (existing) {
    if (existing.secretHash !== hash) {
      await db
        .update(integrations)
        .set({ secretHash: hash, updatedAt: new Date() })
        .where(eq(integrations.id, existing.id));
    }
    return {
      id: existing.id,
      slug: configured.slug,
      allowedEventTypes: existing.allowedEventTypes,
    };
  }

  const [created] = await db
    .insert(integrations)
    .values({
      slug: configured.slug,
      name: configured.name,
      secretHash: hash,
      allowedEventTypes: [...v1.V1_EVENT_TYPES],
    })
    .onConflictDoNothing()
    .returning({
      id: integrations.id,
      allowedEventTypes: integrations.allowedEventTypes,
    });

  if (created) {
    return {
      id: created.id,
      slug: configured.slug,
      allowedEventTypes: created.allowedEventTypes,
    };
  }

  const [retry] = await db
    .select({
      id: integrations.id,
      secretHash: integrations.secretHash,
      allowedEventTypes: integrations.allowedEventTypes,
    })
    .from(integrations)
    .where(eq(integrations.slug, configured.slug))
    .limit(1);
  if (!retry) {
    throw new Error(`Failed to resolve ${configured.slug} integration`);
  }
  if (retry.secretHash !== hash) {
    await db
      .update(integrations)
      .set({ secretHash: hash, updatedAt: new Date() })
      .where(eq(integrations.id, retry.id));
  }
  return {
    id: retry.id,
    slug: configured.slug,
    allowedEventTypes: retry.allowedEventTypes,
  };
}

export function sandboxIntegrationConfiguration(): ConfiguredIntegration {
  const sandbox = configuredIntegration(
    "sandbox",
    "Sandbox",
    process.env.SANDBOX_INTEGRATION_SECRET,
  );
  if (!sandbox) throw new Error("SANDBOX_INTEGRATION_SECRET is not set");
  return sandbox;
}

export function resolveSandboxIntegration(
  db?: Db,
): Promise<AuthenticatedIntegration> {
  return resolveIntegration(sandboxIntegrationConfiguration(), db);
}
