import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { Logger } from "./log.js";
import type { Command, Result } from "./types.js";
import type { Status } from "./types.js";

const RECENT_MAX = 20;

interface Pending {
  command: Command;
  resolve: (r: Result) => void;
  enqueuedAt: number;
  timer?: NodeJS.Timeout;
}

interface Waiter {
  resolve: (c: Command | null) => void;
  timer: NodeJS.Timeout;
}

export interface EnqueueInput {
  code: string;
  timeoutMs?: number;
  meta?: Record<string, unknown>;
}

export interface Bridge {
  /** Enqueue a command and resolve when the plugin returns its result (or on timeout/shutdown). */
  enqueueAndAwait(input: EnqueueInput): Promise<Result>;
  /** Long-poll: resolve with a command the instant one is available, or null after `waitMs`. */
  waitForCommand(waitMs: number, clientId?: string): Promise<Command | null>;
  /** Correlate a posted result back to its awaiting caller. */
  submitResult(result: Result): "accepted" | "unknown";
  /** Record that the plugin polled (drives `pluginConnected`). */
  markPoll(clientId?: string): void;
  getStatus(): Status;
  getRecentErrors(limit?: number): Result[];
  /** Reject/resolve everything pending and stop accepting work. */
  shutdown(reason?: string): void;
}

export function createBridge(config: Config, log: Logger): Bridge {
  const queue: Pending[] = [];
  const inFlight = new Map<string, Pending>();
  const waiters: Waiter[] = [];
  const recentErrors: Result[] = [];
  let lastPollAt: number | null = null;
  let stopped = false;

  function pushRecent(r: Result): void {
    recentErrors.push(r);
    while (recentErrors.length > RECENT_MAX) recentErrors.shift();
  }

  function clampTimeout(ms: number): number {
    return Math.min(config.cmdTimeoutMsMax, Math.max(config.cmdTimeoutMsMin, Math.floor(ms)));
  }

  function timeoutResult(command: Command): Result {
    return {
      commandId: command.commandId,
      ok: false,
      output: "",
      returnValues: null,
      error: {
        message: `Execution timed out after ${command.timeoutMs} ms (no result from the Studio plugin).`,
        traceback: "",
        phase: "timeout",
      },
      durationMs: command.timeoutMs,
    };
  }

  function armTimeout(pending: Pending): void {
    pending.timer = setTimeout(() => {
      if (!inFlight.has(pending.command.commandId)) return;
      inFlight.delete(pending.command.commandId);
      const r = timeoutResult(pending.command);
      pushRecent(r);
      log.warn("command timed out", { commandId: pending.command.commandId, timeoutMs: pending.command.timeoutMs });
      pending.resolve(r);
      dispatch();
    }, pending.command.timeoutMs + 1000); // small transport grace beyond the plugin budget
  }

  /** Hand the head of the queue to a parked waiter — but only one command in-flight at a time. */
  function dispatch(): void {
    while (inFlight.size === 0 && queue.length > 0 && waiters.length > 0) {
      const pending = queue.shift()!;
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      inFlight.set(pending.command.commandId, pending);
      armTimeout(pending);
      log.debug("dispatch", { commandId: pending.command.commandId });
      waiter.resolve(pending.command);
    }
  }

  function enqueueAndAwait(input: EnqueueInput): Promise<Result> {
    if (stopped) return Promise.reject(new Error("bridge is shutting down"));
    if (queue.length >= config.maxQueueDepth) {
      return Promise.reject(new Error(`bridge busy: command queue is full (${config.maxQueueDepth})`));
    }
    const command: Command = {
      commandId: randomUUID(),
      kind: "execute_lua",
      code: input.code,
      timeoutMs: clampTimeout(input.timeoutMs ?? config.cmdTimeoutMs),
      meta: input.meta,
    };
    log.info("enqueue", { commandId: command.commandId, codeLen: input.code.length, label: input.meta?.label });
    return new Promise<Result>((resolve) => {
      queue.push({ command, resolve, enqueuedAt: Date.now() });
      dispatch();
    });
  }

  function waitForCommand(waitMs: number, clientId?: string): Promise<Command | null> {
    markPoll(clientId);
    if (stopped) return Promise.resolve(null);
    const hold = Math.min(Math.max(waitMs, 0), config.pollHoldMs);
    return new Promise<Command | null>((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          resolve(null);
        }, hold),
      };
      waiters.push(waiter);
      dispatch();
    });
  }

  function submitResult(result: Result): "accepted" | "unknown" {
    const pending = inFlight.get(result.commandId);
    if (!pending) return "unknown";
    if (pending.timer) clearTimeout(pending.timer);
    inFlight.delete(result.commandId);
    if (!result.ok) pushRecent(result);
    log.info("result", { commandId: result.commandId, ok: result.ok, durationMs: result.durationMs });
    pending.resolve(result);
    dispatch();
    return "accepted";
  }

  function markPoll(clientId?: string): void {
    lastPollAt = Date.now();
    void clientId; // reserved for future multi-client tracking
  }

  function getStatus(): Status {
    const connected = lastPollAt !== null && Date.now() - lastPollAt <= 2 * config.pollHoldMs;
    return {
      status: "ok",
      bridgeVersion: config.version,
      queueDepth: queue.length,
      inFlight: inFlight.size,
      pluginConnected: connected,
      lastPollAt: lastPollAt !== null ? new Date(lastPollAt).toISOString() : null,
    };
  }

  function getRecentErrors(limit = 5): Result[] {
    const n = Math.max(0, Math.min(limit, recentErrors.length));
    return recentErrors.slice(recentErrors.length - n).reverse();
  }

  function shutdown(reason = "shutting down"): void {
    stopped = true;
    for (const w of waiters.splice(0)) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    const pending = [...queue.splice(0), ...inFlight.values()];
    inFlight.clear();
    for (const p of pending) {
      if (p.timer) clearTimeout(p.timer);
      p.resolve({
        commandId: p.command.commandId,
        ok: false,
        output: "",
        returnValues: null,
        error: { message: `bridge ${reason}`, traceback: "", phase: "internal" },
        durationMs: 0,
      });
    }
  }

  return {
    enqueueAndAwait,
    waitForCommand,
    submitResult,
    markPoll,
    getStatus,
    getRecentErrors,
    shutdown,
  };
}
