import type { PalClient, PalWidgetSnapshot } from "./types";

export interface PalHttpClientOptions {
  apiBaseUrl: string;
  getAccessToken: () => Promise<string>;
  snapshotPath?: string;
  rewardSeenPath?: (rewardId: string) => string;
  fetchImplementation?: typeof fetch;
}

function resolveUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export function createPalHttpClient({
  apiBaseUrl,
  getAccessToken,
  snapshotPath = "/api/v1/learner/snapshot",
  rewardSeenPath = (rewardId) =>
    `/api/v1/learner/rewards/${encodeURIComponent(rewardId)}/seen`,
  fetchImplementation = fetch,
}: PalHttpClientOptions): PalClient {
  async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const token = await getAccessToken();
    if (!token) {
      throw new Error("Pal access token was empty");
    }

    const response = await fetchImplementation(resolveUrl(apiBaseUrl, path), {
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
      });
      return (await response.json()) as PalWidgetSnapshot;
    },
    async markRewardSeen(rewardId, signal) {
      await authorizedFetch(rewardSeenPath(rewardId), {
        method: "POST",
        signal,
      });
    },
  };
}
