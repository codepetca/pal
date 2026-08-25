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
  PalDensity,
  PalMotion,
  PalProviderProps,
  PalRewardNotice,
  PalRewardLoadoutSlot,
  PalTheme,
  PalViewport,
  PalWidgetSnapshot,
} from "./types";
import {
  applyPalFeaturePolicy,
  concealedPalTitleRewardIds,
} from "./feature-policy";

type PalLoadState = "loading" | "ready" | "error";

interface PalContextValue {
  dismissReward: (rewardId: string) => Promise<void>;
  error: Error | null;
  isRewardPending: (rewardId: string) => boolean;
  refresh: () => Promise<void>;
  rewardError: Error | null;
  loadoutError: Error | null;
  loadoutErrorSlot: PalRewardLoadoutSlot | null;
  loadoutPending: boolean;
  setRewardLoadout: (
    slot: PalRewardLoadoutSlot,
    rewardGrantId: string | null,
  ) => Promise<boolean>;
  snapshot: PalWidgetSnapshot | null;
  state: PalLoadState;
  density: PalDensity;
  motion: PalMotion;
  theme: PalTheme;
  viewport: PalViewport;
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

interface PalLoadoutState {
  error: Error | null;
  pending: boolean;
  scopeKey: string;
  slot: PalRewardLoadoutSlot | null;
}

interface PalRequestScope {
  client: PalProviderProps["client"];
  controller: AbortController;
  scopeKey: string;
}

interface PalVisibleRewardQueue {
  rewards: PalRewardNotice[];
  scopeKey: string;
}

interface PalRewardRefill {
  promise: Promise<void> | null;
  scopeKey: string;
}

const MAX_VISIBLE_REWARDS = 100;
const MAX_CONCEALED_TITLE_PAGES = 100;
const REWARD_REFILL_RETRY_BASE_MS = 1_000;
const REWARD_REFILL_RETRY_MAX_MS = 30_000;

function reconcileVisibleRewards(
  current: readonly PalRewardNotice[],
  next: readonly PalRewardNotice[],
): PalRewardNotice[] {
  if (current.length === 0) return next.slice(0, MAX_VISIBLE_REWARDS);
  const nextById = new Map(next.map((reward) => [reward.id, reward]));
  return current.map((reward) => nextById.get(reward.id) ?? reward);
}

function isAbortError(cause: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (cause instanceof DOMException && cause.name === "AbortError") ||
    (cause instanceof Error && cause.name === "AbortError")
  );
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timeout);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function loadSnapshotWithConcealedTitlesConsumed(
  client: PalProviderProps["client"],
  signal: AbortSignal,
): Promise<PalWidgetSnapshot> {
  const consumedIds = new Set<string>();
  for (let page = 0; page < MAX_CONCEALED_TITLE_PAGES; page += 1) {
    const snapshot = await client.getSnapshot(signal);
    const concealedIds = concealedPalTitleRewardIds(snapshot);
    if (concealedIds.length === 0) return applyPalFeaturePolicy(snapshot);
    const newIds = concealedIds.filter((id) => !consumedIds.has(id));
    if (newIds.length === 0) {
      throw new Error("Pal could not advance past a concealed title reward");
    }
    for (const rewardId of newIds) {
      await client.markRewardSeen(rewardId, signal);
      consumedIds.add(rewardId);
    }
  }
  throw new Error("Pal returned too many concealed title reward pages");
}

export function PalProvider({
  children,
  client,
  scopeKey,
  theme = "light",
  density = "comfortable",
  motion = "system",
  viewport = "wide",
  initialSnapshot,
  refreshIntervalMs = 0,
  onError,
}: PalProviderProps) {
  const visibleInitialSnapshot = initialSnapshot
    ? applyPalFeaturePolicy(initialSnapshot)
    : undefined;
  const [resource, setResource] = useState<PalResourceState>({
    error: null,
    scopeKey,
    snapshot: visibleInitialSnapshot ?? null,
    state: visibleInitialSnapshot ? "ready" : "loading",
  });
  const [rewardState, setRewardState] = useState<PalRewardState>({
    error: null,
    pendingIds: new Set(),
    scopeKey,
  });
  const [loadoutState, setLoadoutState] = useState<PalLoadoutState>({
    error: null,
    pending: false,
    scopeKey,
    slot: null,
  });
  const pendingRewardIdsRef = useRef({
    ids: new Set<string>(),
    scopeKey,
  });
  const acknowledgedRewardIdsRef = useRef({
    ids: new Set<string>(),
    scopeKey,
  });
  const visibleRewardQueueRef = useRef<PalVisibleRewardQueue>({
    rewards: visibleInitialSnapshot?.rewards ?? [],
    scopeKey,
  });
  const rewardRefillRef = useRef<PalRewardRefill>({
    promise: null,
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
      visibleRewardQueueRef.current = {
        rewards: [],
        scopeKey,
      };
      rewardRefillRef.current = {
        promise: null,
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
      setLoadoutState({ error: null, pending: false, scopeKey, slot: null });
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
  const currentLoadoutState: PalLoadoutState =
    loadoutState.scopeKey === scopeKey
      ? loadoutState
      : { error: null, pending: false, scopeKey, slot: null };

  const refreshSnapshot = useCallback(async (): Promise<boolean> => {
    const requestScope = requestScopeRef.current;
    if (
      requestScope.client !== client ||
      requestScope.scopeKey !== scopeKey ||
      requestScope.controller.signal.aborted
    ) {
      return false;
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
      const nextSnapshot = await loadSnapshotWithConcealedTitlesConsumed(
        client,
        signal,
      );
      if (
        signal.aborted ||
        sequence !== requestSequence.current ||
        !mountedRef.current ||
        activeScopeRef.current !== scopeKey
      ) {
        return false;
      }
      const serverRewards = nextSnapshot.rewards.filter(
        (reward) => !acknowledgedRewardIdsRef.current.ids.has(reward.id),
      );
      const visibleRewards =
        visibleRewardQueueRef.current.scopeKey === scopeKey
          ? reconcileVisibleRewards(
              visibleRewardQueueRef.current.rewards,
              serverRewards,
            )
          : serverRewards;
      visibleRewardQueueRef.current = {
        rewards: visibleRewards,
        scopeKey,
      };
      const visibleSnapshot = {
        ...nextSnapshot,
        rewards: visibleRewards,
      };
      setResource({
        error: null,
        scopeKey,
        snapshot: visibleSnapshot,
        state: "ready",
      });
      return true;
    } catch (cause) {
      if (isAbortError(cause, signal)) {
        return false;
      }
      if (
        sequence !== requestSequence.current ||
        !mountedRef.current ||
        activeScopeRef.current !== scopeKey
      ) {
        return false;
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
      return false;
    }
  }, [client, scopeKey]);

  const refresh = useCallback(async () => {
    await refreshSnapshot();
  }, [refreshSnapshot]);

  const refillEmptyRewardPage = useCallback(() => {
    const requestScope = requestScopeRef.current;
    if (
      requestScope.client !== client ||
      requestScope.scopeKey !== scopeKey ||
      requestScope.controller.signal.aborted ||
      visibleRewardQueueRef.current.scopeKey !== scopeKey ||
      visibleRewardQueueRef.current.rewards.length > 0
    ) {
      return;
    }
    if (
      rewardRefillRef.current.scopeKey === scopeKey &&
      rewardRefillRef.current.promise
    ) {
      return;
    }

    const { signal } = requestScope.controller;
    const refill = (async () => {
      let failedAttempts = 0;
      while (
        !signal.aborted &&
        activeScopeRef.current === scopeKey &&
        visibleRewardQueueRef.current.scopeKey === scopeKey &&
        visibleRewardQueueRef.current.rewards.length === 0
      ) {
        if (await refreshSnapshot()) return;
        const delayMs = Math.min(
          REWARD_REFILL_RETRY_BASE_MS * (2 ** failedAttempts),
          REWARD_REFILL_RETRY_MAX_MS,
        );
        failedAttempts += 1;
        if (!(await waitForRetry(delayMs, signal))) return;
      }
    })();
    rewardRefillRef.current = { promise: refill, scopeKey };
    void refill.finally(() => {
      if (rewardRefillRef.current.promise === refill) {
        rewardRefillRef.current = { promise: null, scopeKey };
      }
    });
  }, [client, refreshSnapshot, scopeKey]);

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
      const loaded = await refreshSnapshot();
      if (!cancelled && !loaded && typeof window !== "undefined") {
        refillEmptyRewardPage();
      }
      if (!cancelled && refreshIntervalMs > 0) scheduleNext();
    };
    void loadThenSchedule();

    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [refillEmptyRewardPage, refresh, refreshIntervalMs, refreshSnapshot]);

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
        if (visibleRewardQueueRef.current.scopeKey === scopeKey) {
          visibleRewardQueueRef.current.rewards =
            visibleRewardQueueRef.current.rewards.filter(
              (reward) => reward.id !== rewardId,
            );
        }
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
        if (
          visibleRewardQueueRef.current.scopeKey === scopeKey &&
          visibleRewardQueueRef.current.rewards.length === 0
        ) {
          refillEmptyRewardPage();
        }
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
    [client, refillEmptyRewardPage, scopeKey],
  );

  const isRewardPending = useCallback(
    (rewardId: string) => currentRewardState.pendingIds.has(rewardId),
    [currentRewardState.pendingIds],
  );

  const setRewardLoadout = useCallback(
    async (slot: PalRewardLoadoutSlot, rewardGrantId: string | null) => {
      const requestScope = requestScopeRef.current;
      if (
        requestScope.client !== client ||
        requestScope.scopeKey !== scopeKey ||
        requestScope.controller.signal.aborted
      ) return false;
      const setter = requestScope.client.setRewardLoadout;
      if (!setter) {
        const nextError = new Error("This Pal client does not support reward customization");
        setLoadoutState({ error: nextError, pending: false, scopeKey, slot });
        onErrorRef.current?.(nextError);
        return false;
      }
      const { signal } = requestScope.controller;
      setLoadoutState({ error: null, pending: true, scopeKey, slot });
      try {
        await setter(slot, rewardGrantId, signal);
        if (signal.aborted || activeScopeRef.current !== scopeKey) return false;
        const refreshed = await refreshSnapshot();
        if (mountedRef.current && activeScopeRef.current === scopeKey) {
          setLoadoutState(refreshed
            ? { error: null, pending: false, scopeKey, slot: null }
            : {
                error: new Error("Pal saved the customization but could not refresh it"),
                pending: false,
                scopeKey,
                slot,
              });
        }
        return refreshed;
      } catch (cause) {
        if (isAbortError(cause, signal)) return false;
        const nextError = cause instanceof Error
          ? cause
          : new Error("Pal could not update reward customization");
        if (mountedRef.current && activeScopeRef.current === scopeKey) {
          setLoadoutState({ error: nextError, pending: false, scopeKey, slot });
          onErrorRef.current?.(nextError);
        }
        return false;
      }
    },
    [client, refreshSnapshot, scopeKey],
  );

  const value = useMemo(
    () => ({
      dismissReward,
      error: currentResource.error,
      isRewardPending,
      loadoutError: currentLoadoutState.error,
      loadoutErrorSlot: currentLoadoutState.slot,
      loadoutPending: currentLoadoutState.pending,
      refresh,
      rewardError: currentRewardState.error,
      setRewardLoadout,
      snapshot: currentResource.snapshot,
      state: currentResource.state,
      density,
      motion,
      theme,
      viewport,
    }),
    [
      currentResource.error,
      currentResource.snapshot,
      currentResource.state,
      currentRewardState.error,
      currentLoadoutState.error,
      currentLoadoutState.pending,
      currentLoadoutState.slot,
      density,
      dismissReward,
      isRewardPending,
      motion,
      refresh,
      setRewardLoadout,
      theme,
      viewport,
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
