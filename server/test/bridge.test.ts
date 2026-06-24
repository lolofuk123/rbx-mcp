import { describe, it, expect } from "vitest";
import { createBridge } from "../src/bridge.js";
import { loadConfig } from "../src/config.js";
import type { Logger } from "../src/log.js";
import type { Result } from "../src/types.js";

const silent: Logger = { error() {}, warn() {}, info() {}, debug() {} };

function okResult(commandId: string, over: Partial<Result> = {}): Result {
  return { commandId, ok: true, output: "", returnValues: ["2"], error: null, durationMs: 1, ...over };
}

describe("bridge", () => {
  it("round-trips: enqueue -> poll -> submit", async () => {
    const bridge = createBridge(loadConfig({}), silent);
    const p = bridge.enqueueAndAwait({ code: "return 1+1" });
    const cmd = await bridge.waitForCommand(1000, "c1");
    expect(cmd).not.toBeNull();
    expect(cmd!.code).toBe("return 1+1");
    expect(bridge.submitResult(okResult(cmd!.commandId))).toBe("accepted");
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.returnValues).toEqual(["2"]);
  });

  it("serializes execution: one in-flight at a time, FIFO order", async () => {
    const bridge = createBridge(loadConfig({}), silent);
    const p1 = bridge.enqueueAndAwait({ code: "a" });
    const p2 = bridge.enqueueAndAwait({ code: "b" });

    const c1 = await bridge.waitForCommand(1000);
    expect(c1!.code).toBe("a");

    // While "a" is in-flight, a poll must not be handed "b".
    expect(await bridge.waitForCommand(50)).toBeNull();

    bridge.submitResult(okResult(c1!.commandId));
    const c2 = await bridge.waitForCommand(1000);
    expect(c2!.code).toBe("b");
    bridge.submitResult(okResult(c2!.commandId));
    await Promise.all([p1, p2]);
  });

  it("times out, resolving a timeout result; a late submit is unknown", async () => {
    const bridge = createBridge(loadConfig({}), silent);
    const p = bridge.enqueueAndAwait({ code: "while true do end", timeoutMs: 1000 });
    const cmd = await bridge.waitForCommand(1000);
    const r = await p; // resolves ~timeoutMs + 1s grace
    expect(r.ok).toBe(false);
    expect(r.error?.phase).toBe("timeout");
    expect(bridge.submitResult(okResult(cmd!.commandId))).toBe("unknown");
  }, 6000);

  it("captures recent errors newest-first", async () => {
    const bridge = createBridge(loadConfig({}), silent);
    for (let i = 0; i < 3; i++) {
      const p = bridge.enqueueAndAwait({ code: "x" });
      const cmd = await bridge.waitForCommand(1000);
      bridge.submitResult(
        okResult(cmd!.commandId, {
          ok: false,
          returnValues: null,
          error: { message: `e${i}`, traceback: "", phase: "runtime" },
        }),
      );
      await p;
    }
    const errs = bridge.getRecentErrors(2);
    expect(errs).toHaveLength(2);
    expect(errs[0]!.error?.message).toBe("e2");
    expect(errs[1]!.error?.message).toBe("e1");
  });

  it("rejects new work when the queue is full", async () => {
    const bridge = createBridge(loadConfig({ RBXMCP_MAX_QUEUE_DEPTH: "1" }), silent);
    const p1 = bridge.enqueueAndAwait({ code: "a" });
    await expect(bridge.enqueueAndAwait({ code: "b" })).rejects.toThrow(/busy/);
    const c = await bridge.waitForCommand(1000);
    bridge.submitResult(okResult(c!.commandId));
    await p1;
  });

  it("pluginConnected reflects recent polls", () => {
    const bridge = createBridge(loadConfig({}), silent);
    expect(bridge.getStatus().pluginConnected).toBe(false);
    bridge.markPoll("c1");
    expect(bridge.getStatus().pluginConnected).toBe(true);
  });

  it("shutdown resolves pending work with an internal error", async () => {
    const bridge = createBridge(loadConfig({}), silent);
    const p = bridge.enqueueAndAwait({ code: "a" });
    bridge.shutdown();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error?.phase).toBe("internal");
  });
});
