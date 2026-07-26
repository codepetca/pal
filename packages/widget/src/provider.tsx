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
  refresh: () => Promise<void>;
  snapshot: PalWidgetSnapshot | null;
  state: PalLoadState;
  theme: PalTheme;
}

const PalContext = createContext<PalContextValue | null>(null);

export function PalProvider({
  children,
  client,
  theme = "light",
  initialSnapshot,
  refreshIntervalMs = 0,
  onError,
}: PalProviderProps) {
  const [snapshot, setSnapshot] = useState<PalWidgetSnapshot | null>(
    initialSnapshot ?? null,
  );
  const [state, setState] = useState<PalLoadState>(
    initialSnapshot ? "ready" : "loading",
  );
  const [error, setError] = useState<Error | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState((current) => (current === "ready" ? current : "loading"));
    try {
      const nextSnapshot = await client.getSnapshot();
      if (sequence !== requestSequence.current) return;
      setSnapshot(nextSnapshot);
      setError(null);
      setState("ready");
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      const nextError =
        cause instanceof Error ? cause : new Error("Pal could not load learner state");
      setError(nextError);
      setState("error");
      onError?.(nextError);
    }
  }, [client, onError]);

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
      setSnapshot((current) =>
        current
          ? {
              ...current,
              rewards: current.rewards.filter((reward) => reward.id !== rewardId),
            }
          : current,
      );
      try {
        await client.markRewardSeen(rewardId);
      } catch (cause) {
        const nextError =
          cause instanceof Error ? cause : new Error("Pal could not dismiss reward");
        onError?.(nextError);
        await refresh();
      }
    },
    [client, onError, refresh],
  );

  const value = useMemo(
    () => ({
      dismissReward,
      error,
      refresh,
      snapshot,
      state,
      theme,
    }),
    [dismissReward, error, refresh, snapshot, state, theme],
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
