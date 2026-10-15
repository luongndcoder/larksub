import type { PluginRpcContract } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";
import type { z } from "zod";
import type { LarkStateView } from "../shared/model";
import { getState } from "../shared/rpc";

export const VISIBLE_POLL_MS = 10_000;
const IDLE_POLL_MS = 45_000;
const LOGIN_POLL_MS = 1_500;

export interface StoreSnapshot {
  readonly state: LarkStateView | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export class LarkSubStore {
  private snapshot: StoreSnapshot = { state: null, loading: true, error: null };
  private readonly listeners = new Set<() => void>();
  private readonly client: PluginClientContext;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closeWatchers = 0;
  private visibleWatchers = 0;
  private inflight: Promise<void> | null = null;

  constructor(client: PluginClientContext) {
    this.client = client;
  }

  start(): () => void {
    void this.refresh();
    this.schedule();
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.listeners.clear();
    };
  }

  get current(): StoreSnapshot {
    return this.snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  watch(intervalMs: number): () => void {
    if (intervalMs <= LOGIN_POLL_MS) {
      this.closeWatchers += 1;
      this.schedule();
      return () => {
        this.closeWatchers = Math.max(0, this.closeWatchers - 1);
        this.schedule();
      };
    }
    this.visibleWatchers += 1;
    this.schedule();
    return () => {
      this.visibleWatchers = Math.max(0, this.visibleWatchers - 1);
      this.schedule();
    };
  }

  watchClosely(): () => void {
    return this.watch(LOGIN_POLL_MS);
  }

  async refresh(options?: { refresh?: boolean; accountId?: string }): Promise<void> {
    if (this.inflight && !options?.refresh) return this.inflight;
    const run = (async () => {
      try {
        const state = await this.client.rpc(getState, {
          refresh: options?.refresh,
          accountId: options?.accountId,
        });
        this.update({ state, loading: false, error: null });
      } catch (error) {
        this.update({ ...this.snapshot, loading: false, error: describe(error) });
      }
    })();
    this.inflight = run;
    try {
      await run;
    } finally {
      if (this.inflight === run) this.inflight = null;
    }
  }

  async rpc<Input extends z.ZodType, Output extends z.ZodType>(
    contract: PluginRpcContract<Input, Output>,
    input: z.input<Input>,
  ): Promise<z.output<Output>> {
    const result = await this.client.rpc(contract, input);
    if (isStateView(result)) {
      this.update({ state: result, loading: false, error: null });
    } else {
      void this.refresh();
    }
    return result;
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    const interval =
      this.closeWatchers > 0
        ? LOGIN_POLL_MS
        : this.visibleWatchers > 0
          ? VISIBLE_POLL_MS
          : IDLE_POLL_MS;
    this.timer = setInterval(() => {
      void this.refresh();
    }, interval);
  }

  private update(next: StoreSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useStore(store: LarkSubStore): StoreSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    () => store.current,
    () => store.current,
  );
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStateView(value: unknown): value is LarkStateView {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as LarkStateView).accounts) &&
    typeof (value as LarkStateView).sessionBindings === "object"
  );
}
