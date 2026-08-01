import {
  createPalHttpClient,
  type PalClient,
} from "@codepet/pal-widget";

const TOKEN_REFRESH_BUFFER_MS = 30_000;

type SandboxTokenResponse = {
  token: string;
  expires_at: string;
};

export interface SandboxPalClient extends PalClient {
  invalidateAccessToken(): void;
}

function validTokenResponse(value: unknown): value is SandboxTokenResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    typeof candidate.expires_at === "string" &&
    Number.isFinite(Date.parse(candidate.expires_at))
  );
}

/**
 * Creates the same authenticated HTTP client a host integration uses. The only
 * sandbox-specific step is exchanging the browser-session learner ID for a
 * short-lived read token through a same-origin, development-only server route.
 */
export function createSandboxPalClient(
  learnerId: string,
  apiBaseUrl: string,
  fetchImplementation: typeof fetch = fetch,
): SandboxPalClient {
  let cachedToken: { token: string; expiresAtMs: number } | null = null;

  async function getAccessToken(signal?: AbortSignal): Promise<string> {
    if (
      cachedToken &&
      cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > Date.now()
    ) {
      return cachedToken.token;
    }

    const tokenUrl = new URL("/api/sandbox/read-token", apiBaseUrl);
    const response = await fetchImplementation(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ learner_id: learnerId }),
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `Pal could not authorize the sandbox learner (${response.status})`,
      );
    }
    const body: unknown = await response.json();
    if (!validTokenResponse(body)) {
      throw new Error("Pal returned an invalid sandbox learner token response");
    }
    cachedToken = {
      token: body.token,
      expiresAtMs: Date.parse(body.expires_at),
    };
    return cachedToken.token;
  }

  const httpClient = createPalHttpClient({
    apiBaseUrl,
    getAccessToken,
    fetchImplementation,
  });

  return {
    ...httpClient,
    invalidateAccessToken() {
      cachedToken = null;
    },
  };
}
