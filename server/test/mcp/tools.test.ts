import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBridge, type Bridge } from "../../src/bridge.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/log.js";
import type { Logger } from "../../src/log.js";

const silent: Logger = { error() {}, warn() {}, info() {}, debug() {} };

async function harness(logger: Logger = silent) {
  const config = loadConfig({});
  const bridge = createBridge(config, logger);
  const server = createMcpServer(bridge, config, logger);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientT);
  return { bridge, client, server };
}

function textOf(res: { content: Array<{ text?: string }> }): string {
  return res.content.map((c) => c.text ?? "").join("\n");
}

/** Simulate the Studio plugin: pick up the next command and answer it. */
async function answerNext(bridge: Bridge, answer: Parameters<Bridge["submitResult"]>[0]): Promise<void> {
  const cmd = await bridge.waitForCommand(2000);
  if (!cmd) throw new Error("no command was enqueued");
  bridge.submitResult({ ...answer, commandId: cmd.commandId });
}

describe("mcp tools", () => {
  it("advertises the three tools", async () => {
    const { client } = await harness();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["execute_lua", "get_errors", "read_studio_state"]);
  });

  it("execute_lua round-trips a success result", async () => {
    const { bridge, client } = await harness();
    bridge.markPoll("c1"); // mark plugin connected
    const call = client.callTool({ name: "execute_lua", arguments: { code: "return 1+1" } });
    await answerNext(bridge, { ok: true, output: "hi", returnValues: ["2"], error: null, durationMs: 5, commandId: "" });
    const res = await call;
    expect(res.isError).toBeFalsy();
    const text = textOf(res as never);
    expect(text).toContain("returns: 2");
    expect(text).toContain("hi");
  });

  it("execute_lua fails fast when the plugin is not connected", async () => {
    const { client } = await harness();
    const res = await client.callTool({ name: "execute_lua", arguments: { code: "return 1" } });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toContain("isn't connected");
  });

  it("execute_lua surfaces an error result with traceback", async () => {
    const { bridge, client } = await harness();
    bridge.markPoll();
    const call = client.callTool({ name: "execute_lua", arguments: { code: "error('x')" } });
    await answerNext(bridge, {
      ok: false,
      output: "",
      returnValues: null,
      error: { message: "boom", traceback: "tb here", phase: "runtime" },
      durationMs: 1,
      commandId: "",
    });
    const res = await call;
    expect(res.isError).toBe(true);
    const text = textOf(res as never);
    expect(text).toContain("runtime error: boom");
    expect(text).toContain("tb here");
  });

  it("read_studio_state(instance) requires a valid path", async () => {
    const { client } = await harness();
    const res = await client.callTool({ name: "read_studio_state", arguments: { query: "instance" } });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toContain("path");
  });

  it("read_studio_state(selection) runs the server-owned snippet", async () => {
    const { bridge, client } = await harness();
    bridge.markPoll();
    const call = client.callTool({ name: "read_studio_state", arguments: { query: "selection" } });
    const cmd = await bridge.waitForCommand(2000);
    expect(cmd!.code).toContain("Selection");
    bridge.submitResult({ commandId: cmd!.commandId, ok: true, output: "(nothing selected)", returnValues: null, error: null, durationMs: 1 });
    const res = await call;
    expect(res.isError).toBeFalsy();
  });

  it("get_errors returns recent failures", async () => {
    const { bridge, client } = await harness();
    const p = bridge.enqueueAndAwait({ code: "x" });
    const cmd = await bridge.waitForCommand(2000);
    bridge.submitResult({ commandId: cmd!.commandId, ok: false, output: "", returnValues: null, error: { message: "e1", traceback: "", phase: "runtime" }, durationMs: 1 });
    await p;
    const res = await client.callTool({ name: "get_errors", arguments: {} });
    expect(textOf(res as never)).toContain("e1");
  });

  it("never writes to stdout during a session", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const { bridge, client } = await harness(createLogger("debug"));
      bridge.markPoll();
      const call = client.callTool({ name: "execute_lua", arguments: { code: "return 1", label: "x" } });
      await answerNext(bridge, { ok: true, output: "", returnValues: ["1"], error: null, durationMs: 1, commandId: "" });
      await call;
      expect(out).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
    }
  });
});
