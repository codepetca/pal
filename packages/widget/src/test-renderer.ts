/**
 * Compatibility boundary for the legacy renderer-based tests. Keeping the
 * deprecated dependency behind one adapter prevents it spreading while the
 * suite is migrated incrementally to DOM-based tests.
 */
import {
  act,
  create as createRenderer,
  type ReactTestRenderer,
} from "react-test-renderer";

const DEPRECATION_PREFIX = "react-test-renderer is deprecated";

export { act, type ReactTestRenderer };

export const create: typeof createRenderer = (...args) => {
  const originalError = console.error;
  console.error = (...messages: unknown[]) => {
    if (
      typeof messages[0] === "string" &&
      messages[0].startsWith(DEPRECATION_PREFIX)
    ) {
      return;
    }
    originalError(...messages);
  };
  try {
    return createRenderer(...args);
  } finally {
    console.error = originalError;
  }
};
