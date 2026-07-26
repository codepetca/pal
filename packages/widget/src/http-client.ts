import { parsePalWidgetSnapshot } from "./snapshot-validation";
import type { PalClient } from "./types";

export interface PalHttpClientOptions {
  apiBaseUrl: string;
  getAccessToken: (signal?: AbortSignal) => Promise<string>;
  snapshotPath?: string;
  rewardSeenPath?: (rewardId: string) => string;
  fetchImplementation?: typeof fetch;
}

function resolveUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
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
  getAccessToken,
  snapshotPath = "/api/v1/learner/snapshot",
  rewardSeenPath = (rewardId) =>
    `/api/v1/learner/rewards/${encodeURIComponent(rewardId)}/seen`,
  fetchImplementation = fetch,
}: PalHttpClientOptions): PalClient {
  async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
    const signal = init.signal ?? undefined;
    const token = await abortable(getAccessToken(signal), signal);
    if (signal?.aborted) {
      throw abortError();
    }
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
      return parsePalWidgetSnapshot(await response.json());
    },
    async markRewardSeen(rewardId, signal) {
      await authorizedFetch(rewardSeenPath(rewardId), {
        method: "POST",
        signal,
      });
    },
  };
}
