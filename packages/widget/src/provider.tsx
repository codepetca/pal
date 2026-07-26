"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PalProviderProps,
  PalTheme,
  PalWidgetSnapshot,
} from "./types";

type PalLoadState = "loading" | "ready" | "error";

interface PalContextValue {
  dismissReward: (rewardId: string) => Promise<void>;
  error: Error | null;
  isRewardPending: (rewardId: string) => boolean;
  refresh: () => Promise<void>;
  rewardError: Error | null;
  snapshot: PalWidgetSnapshot | null;
  state: PalLoadState;
  theme: PalTheme;
}

const PalContext = createContext<PalContextValue | null>(null);

interface PalResourceState {
  error: Error | null;
  scopeKey: string;
  snapshot: PalWidgetSnapshot | null;
  state: PalLoadState;
}

interface PalRewardState {
  error: Error | null;
  pendingIds: Set<string>;
  scopeKey: string;
}

interface PalRequestScope {
  client: PalProviderProps["client"];
  controller: AbortController;
  scopeKey: string;
}

function isAbortError(cause: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (cause instanceof DOMException && cause.name === "AbortError") ||
    (cause instanceof Error && cause.name === "AbortError")
  );
}

export function PalProvider({
  children,
  client,
  scopeKey,
  theme = "light",
  initialSnapshot,
  refreshIntervalMs = 0,
  onError,
}: PalProviderProps) {
  const [resource, setResource] = useState<PalResourceState>({
    error: null,
    scopeKey,
    snapshot: initialSnapshot ?? null,
    state: initialSnapshot ? "ready" : "loading",
  });
  const [rewardState, setRewardState] = useState<PalRewardState>({
    error: null,
    pendingIds: new Set(),
    scopeKey,
  });
  const pendingRewardIdsRef = useRef({
    ids: new Set<string>(),
    scopeKey,
  });
  const acknowledgedRewardIdsRef = useRef({
    ids: new Set<string>(),
    scopeKey,
  });
  const requestSequence = useRef(0);
  const onErrorRef = useRef(onError);
  const activeScopeRef = useRef(scopeKey);
  const requestScopeRef = useRef<PalRequestScope>({
    client,
    controller: new AbortController(),
    scopeKey,
  });
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    const previous = requestScopeRef.current;
    const scopeChanged =
      previous.client !== client ||
      previous.scopeKey !== scopeKey ||
      previous.controller.signal.aborted;
    if (scopeChanged) {
      previous.controller.abort();
      requestScopeRef.current = {
        client,
        controller: new AbortController(),
        scopeKey,
      };
      requestSequence.current += 1;
      pendingRewardIdsRef.current = {
        ids: new Set(),
        scopeKey,
      };
      acknowledgedRewardIdsRef.current = {
        ids: new Set(),
        scopeKey,
      };
      setResource({
        error: null,
        scopeKey,
        snapshot: null,
        state: "loading",
      });
      setRewardState({
        error: null,
        pendingIds: new Set(),
        scopeKey,
      });
    }
    const committedRequestScope = requestScopeRef.current;
    activeScopeRef.current = scopeKey;
    return () => {
      committedRequestScope.controller.abort();
    };
  }, [client, scopeKey]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const currentResource: PalResourceState =
    resource.scopeKey === scopeKey
      ? resource
      : {
          error: null,
          scopeKey,
          snapshot: null,
          state: "loading",
        };
  const currentRewardState: PalRewardState =
    rewardState.scopeKey === scopeKey
      ? rewardState
      : {
          error: null,
          pendingIds: new Set(),
          scopeKey,
        };

  const refresh = useCallback(async () => {
    const requestScope = requestScopeRef.current;
    if (
      requestScope.client !== client ||
      requestScope.scopeKey !== scopeKey ||
      requestScope.controller.signal.aborted
    ) {
      return;
    }
    const { signal } = requestScope.controller;
    const sequence = ++requestSequence.current;
    if (acknowledgedRewardIdsRef.current.scopeKey !== scopeKey) {
      acknowledgedRewardIdsRef.current = {
        ids: new Set(),
        scopeKey,
      };
    }
    setResource((current) =>
      current.scopeKey === scopeKey
        ? {
            ...current,
            error: null,
            state: current.snapshot ? "ready" : "loading",
          }
        : {
            error: null,
            scopeKey,
            snapshot: null,
            state: "loading",
        },
    );
    try {
      const nextSnapshot = await client.getSnapshot(signal);
      if (
        signal.aborted ||
        sequence !== requestSequence.current ||
        !mountedRef.current ||
        activeScopeRef.current !== scopeKey
      ) {
        return;
      }
      const visibleSnapshot = {
        ...nextSnapshot,
        rewards: nextSnapshot.rewards.filter(
          (reward) => !acknowledgedRewardIdsRef.current.ids.has(reward.id),
        ),
      };
      setResource({
        error: null,
        scopeKey,
        snapshot: visibleSnapshot,
        state: "ready",
      });
    } catch (cause) {
      if (isAbortError(cause, signal)) {
        return;
      }
      if (
        sequence !== requestSequence.current ||
        !mountedRef.current ||
        activeScopeRef.current !== scopeKey
      ) {
        return;
      }
      const nextError =
        cause instanceof Error ? cause : new Error("Pal could not load learner state");
      setResource((current) =>
        current.scopeKey === scopeKey && current.snapshot
          ? {
              ...current,
              error: nextError,
              state: "ready",
            }
          : {
              error: nextError,
              scopeKey,
              snapshot: null,
              state: "error",
            },
      );
      onErrorRef.current?.(nextError);
    }
  }, [client, scopeKey]);

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;

    const scheduleNext = () => {
      timeout = window.setTimeout(async () => {
        await refresh();
        if (!cancelled) scheduleNext();
      }, refreshIntervalMs);
    };

    const loadThenSchedule = async () => {
      await refresh();
      if (!cancelled && refreshIntervalMs > 0) scheduleNext();
    };
    void loadThenSchedule();

    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [refresh, refreshIntervalMs]);

  const dismissReward = useCallback(
    async (rewardId: string) => {
      const requestScope = requestScopeRef.current;
      if (
        requestScope.client !== client ||
        requestScope.scopeKey !== scopeKey ||
        requestScope.controller.signal.aborted
      ) {
        return;
      }
      const { signal } = requestScope.controller;
      if (pendingRewardIdsRef.current.scopeKey !== scopeKey) {
        pendingRewardIdsRef.current = {
          ids: new Set(),
          scopeKey,
        };
      }
      if (acknowledgedRewardIdsRef.current.scopeKey !== scopeKey) {
        acknowledgedRewardIdsRef.current = {
          ids: new Set(),
          scopeKey,
        };
      }
      if (acknowledgedRewardIdsRef.current.ids.has(rewardId)) return;
      if (pendingRewardIdsRef.current.ids.has(rewardId)) return;

      const pendingIds = pendingRewardIdsRef.current.ids;
      pendingIds.add(rewardId);
      setRewardState({
        error: null,
        pendingIds: new Set(pendingIds),
        scopeKey,
      });

      try {
        await client.markRewardSeen(rewardId, signal);
        if (
          signal.aborted ||
          !mountedRef.current ||
          activeScopeRef.current !== scopeKey
        ) {
          return;
        }
        acknowledgedRewardIdsRef.current.ids.add(rewardId);
        setResource((current) =>
          current.scopeKey === scopeKey && current.snapshot
            ? {
                ...current,
                snapshot: {
                  ...current.snapshot,
                  rewards: current.snapshot.rewards.filter(
                    (reward) => reward.id !== rewardId,
                  ),
                },
              }
            : current,
        );
      } catch (cause) {
        if (isAbortError(cause, signal)) {
          return;
        }
        if (
          !mountedRef.current ||
          activeScopeRef.current !== scopeKey
        ) {
          return;
        }
        const nextError =
          cause instanceof Error ? cause : new Error("Pal could not dismiss reward");
        setRewardState((current) =>
          current.scopeKey === scopeKey
            ? {
                ...current,
                error: nextError,
              }
            : current,
        );
        onErrorRef.current?.(nextError);
      } finally {
        pendingIds.delete(rewardId);
        if (
          mountedRef.current &&
          activeScopeRef.current === scopeKey &&
          pendingRewardIdsRef.current.scopeKey === scopeKey &&
          pendingRewardIdsRef.current.ids === pendingIds
        ) {
          setRewardState((current) =>
            current.scopeKey === scopeKey
              ? {
                  ...current,
                  pendingIds: new Set(pendingIds),
                }
              : current,
          );
        }
      }
    },
    [client, scopeKey],
  );

  const isRewardPending = useCallback(
    (rewardId: string) => currentRewardState.pendingIds.has(rewardId),
    [currentRewardState.pendingIds],
  );

  const value = useMemo(
    () => ({
      dismissReward,
      error: currentResource.error,
      isRewardPending,
      refresh,
      rewardError: currentRewardState.error,
      snapshot: currentResource.snapshot,
      state: currentResource.state,
      theme,
    }),
    [
      currentResource.error,
      currentResource.snapshot,
      currentResource.state,
      currentRewardState.error,
      dismissReward,
      isRewardPending,
      refresh,
      theme,
    ],
  );

  return <PalContext.Provider value={value}>{children}</PalContext.Provider>;
}

export function usePalWidget(): PalContextValue {
  const value = useContext(PalContext);
  if (!value) {
    throw new Error("Pal widget surfaces must be rendered inside PalProvider");
  }
  return value;
}
