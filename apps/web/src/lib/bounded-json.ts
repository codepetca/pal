export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "invalid_json" | "request_too_large" };

/**
 * Parse a JSON request without allowing a missing or forged Content-Length to
 * bypass the route's memory bound. Content-Length is only an early rejection;
 * the streamed byte count is authoritative.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, error: "request_too_large" };
    }
  }
  if (!request.body) return { ok: false, error: "invalid_json" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let receivedBytes = 0;
  let source = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel("request too large").catch(() => undefined);
        return { ok: false, error: "request_too_large" };
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch {
    return { ok: false, error: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
}
