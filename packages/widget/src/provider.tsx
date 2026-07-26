"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  const requestSequence = useRef(0);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

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
    const sequence = ++requestSequence.current;
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
    setRewardState((current) =>
      current.scopeKey === scopeKey
        ? {
            ...current,
            error: null,
          }
        : current,
    );
    try {
      const nextSnapshot = await client.getSnapshot();
      if (sequence !== requestSequence.current) return;
      setResource({
        error: null,
        scopeKey,
        snapshot: nextSnapshot,
        state: "ready",
      });
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
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
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    const interval = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [refresh, refreshIntervalMs]);

  const dismissReward = useCallback(
    async (rewardId: string) => {
      if (pendingRewardIdsRef.current.scopeKey !== scopeKey) {
        pendingRewardIdsRef.current = {
          ids: new Set(),
          scopeKey,
        };
      }
      if (pendingRewardIdsRef.current.ids.has(rewardId)) return;

      pendingRewardIdsRef.current.ids.add(rewardId);
      setRewardState({
        error: null,
        pendingIds: new Set(pendingRewardIdsRef.current.ids),
        scopeKey,
      });

      try {
        await client.markRewardSeen(rewardId);
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
        if (pendingRewardIdsRef.current.scopeKey === scopeKey) {
          pendingRewardIdsRef.current.ids.delete(rewardId);
          setRewardState((current) =>
            current.scopeKey === scopeKey
              ? {
                  ...current,
                  pendingIds: new Set(pendingRewardIdsRef.current.ids),
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
