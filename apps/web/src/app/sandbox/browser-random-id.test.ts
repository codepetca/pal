import assert from "node:assert/strict";
import test from "node:test";

import { browserRandomUuid } from "./browser-random-id";

test("uses the browser's native randomUUID when available", () => {
  assert.equal(
    browserRandomUuid({
      randomUUID: () => "native-uuid",
      getRandomValues: (bytes) => bytes,
    }),
    "native-uuid",
  );
});

test("builds an RFC 4122 version 4 UUID when randomUUID is unavailable", () => {
  const uuid = browserRandomUuid({
    getRandomValues: (bytes) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    },
  });

  assert.equal(uuid, "00010203-0405-4607-8809-0a0b0c0d0e0f");
});
