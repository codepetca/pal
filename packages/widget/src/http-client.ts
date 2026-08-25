import { parsePalWidgetSnapshot } from "./snapshot-validation";
import type { PalClient, PalRewardLoadoutSlot } from "./types";

export interface PalHttpClientOptions {
  apiBaseUrl: string;
  allowedAssetOrigins?: readonly string[];
  getAccessToken: (signal?: AbortSignal) => Promise<string>;
  snapshotPath?: string;
  rewardSeenPath?: (rewardId: string) => string;
  rewardLoadoutPath?: string;
  fetchImplementation?: typeof fetch;
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function secureApiBaseUrl(candidate: string): URL {
  const baseUrl = new URL(candidate.endsWith("/") ? candidate : `${candidate}/`);
  const secureTransport =
    baseUrl.protocol === "https:" ||
    (baseUrl.protocol === "http:" && isLocalDevelopmentHost(baseUrl.hostname));

  if (!secureTransport || baseUrl.username || baseUrl.password) {
    throw new Error(
      "Pal API base URL must use HTTPS, except for credential-free local development",
    );
  }

  return baseUrl;
}

function resolveUrl(baseUrl: URL, path: string): string {
  const resolved = new URL(path, baseUrl);
  if (
    resolved.origin !== baseUrl.origin ||
    resolved.username ||
    resolved.password
  ) {
    throw new Error("Pal API request paths must stay on the configured API origin");
  }
  return resolved.toString();
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function createPalHttpClient({
  apiBaseUrl,
  allowedAssetOrigins,
  getAccessToken,
  snapshotPath = "/api/v1/learner/snapshot",
  rewardSeenPath = (rewardId) =>
    `/api/v1/learner/rewards/${encodeURIComponent(rewardId)}/seen`,
  rewardLoadoutPath = "/api/v1/learner/reward-loadout",
  fetchImplementation = fetch,
}: PalHttpClientOptions): PalClient {
  const baseUrl = secureApiBaseUrl(apiBaseUrl);

  async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const requestUrl = resolveUrl(baseUrl, path);
    const signal = init.signal ?? undefined;
    const token = await abortable(getAccessToken(signal), signal);
    if (signal?.aborted) {
      throw abortError();
    }
    if (!token) {
      throw new Error("Pal access token was empty");
    }

    const response = await fetchImplementation(requestUrl, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Pal request failed with HTTP ${response.status}`);
    }
    return response;
  }

  return {
    async getSnapshot(signal) {
      const response = await authorizedFetch(snapshotPath, {
        method: "GET",
        signal,
        headers: { "X-Pal-Collectible-Finish": "2" },
      });
      return parsePalWidgetSnapshot(await response.json(), {
        assetBaseUrl: baseUrl.toString(),
        allowedAssetOrigins,
      });
    },
    async markRewardSeen(rewardId, signal) {
      await authorizedFetch(rewardSeenPath(rewardId), {
        method: "POST",
        signal,
      });
    },
    async setRewardLoadout(slot: PalRewardLoadoutSlot, rewardGrantId, signal) {
      await authorizedFetch(rewardLoadoutPath, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot, rewardGrantId }),
      });
    },
    async setCompanionVisibility(hidden, signal) {
      await authorizedFetch(rewardLoadoutPath, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot: "companion", hidden }),
      });
    },
  };
}
