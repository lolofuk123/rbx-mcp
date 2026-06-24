import { describe, it, expect } from "vitest";
import { request } from "node:http";
import { createBridge } from "../src/bridge.js";
import { createHttpServer } from "../src/http.js";
import { loadConfig, type Config } from "../src/config.js";
import type { Logger } from "../src/log.js";

const silent: Logger = { error() {}, warn() {}, info() {}, debug() {} };

async function setup(env: NodeJS.ProcessEnv = {}) {
  const config: Config = { ...loadConfig(env), port: 0 }; // ephemeral port
  const bridge = createBridge(config, silent);
  const http = createHttpServer(bridge, config, silent);
  const { port } = await http.start();
  return { config, bridge, http, port, base: `http://127.0.0.1:${port}` };
}

const jsonHeaders = { "content-type": "application/json" };

/** Raw GET so we can set a Host header that undici/fetch would otherwise strip. */
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("http server", () => {
  it("GET /v1/health returns ok", async () => {
    const { base, http } = await setup();
    const res = await fetch(`${base}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.pluginConnected).toBe(false);
    await http.stop();
  });

  it("long-poll wakeup + result correlation", async () => {
    const { bridge, base, http } = await setup();
    const pollPromise = fetch(`${base}/v1/poll?clientId=c1&wait=2000`);
    const resultPromise = bridge.enqueueAndAwait({ code: "return 1+1" });

    const pollRes = await pollPromise;
    expect(pollRes.status).toBe(200);
    const pollBody = await pollRes.json();
    expect(pollBody.type).toBe("command");
    expect(pollBody.command.code).toBe("return 1+1");

    const post = await fetch(`${base}/v1/result`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        commandId: pollBody.command.commandId,
        ok: true,
        output: "",
        returnValues: ["2"],
        error: null,
        durationMs: 1,
      }),
    });
    expect(post.status).toBe(200);
    expect((await post.json()).accepted).toBe(true);

    const r = await resultPromise;
    expect(r.returnValues).toEqual(["2"]);
    await http.stop();
  });

  it("accepts a minimal result body (omitted error/returnValues)", async () => {
    const { bridge, base, http } = await setup();
    const resultPromise = bridge.enqueueAndAwait({ code: "x" });
    const poll = await fetch(`${base}/v1/poll?wait=2000`);
    const cmd = (await poll.json()).command;
    // Mirrors what the Lua plugin sends when nil fields are omitted by JSONEncode.
    const post = await fetch(`${base}/v1/result`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ commandId: cmd.commandId, ok: true, output: "done", durationMs: 3 }),
    });
    expect(post.status).toBe(200);
    const r = await resultPromise;
    expect(r.ok).toBe(true);
    expect(r.returnValues).toBeNull();
    expect(r.error).toBeNull();
    await http.stop();
  });

  it("idle poll returns 204", async () => {
    const { base, http } = await setup();
    const res = await fetch(`${base}/v1/poll?clientId=c1&wait=50`);
    expect(res.status).toBe(204);
    await http.stop();
  });

  it("unknown commandId -> 404", async () => {
    const { base, http } = await setup();
    const res = await fetch(`${base}/v1/result`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ commandId: "nope", ok: true, output: "", returnValues: null, error: null, durationMs: 0 }),
    });
    expect(res.status).toBe(404);
    await http.stop();
  });

  it("malformed result body -> 400", async () => {
    const { base, http } = await setup();
    const bad = await fetch(`${base}/v1/result`, { method: "POST", headers: jsonHeaders, body: "{not json" });
    expect(bad.status).toBe(400);
    const incomplete = await fetch(`${base}/v1/result`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ ok: true }) });
    expect(incomplete.status).toBe(400);
    await http.stop();
  });

  it("oversize result body -> 413", async () => {
    const { base, http } = await setup({ RBXMCP_MAX_RESULT_BYTES: "1024" });
    const big = "x".repeat(5000);
    const res = await fetch(`${base}/v1/result`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ commandId: "a", ok: true, output: big, returnValues: null, error: null, durationMs: 0 }),
    });
    expect(res.status).toBe(413);
    await http.stop();
  });

  it("enforces the token everywhere except /health", async () => {
    const { base, http } = await setup({ RBXMCP_TOKEN: "secret" });
    expect((await fetch(`${base}/v1/poll?wait=10`)).status).toBe(401);
    expect((await fetch(`${base}/v1/poll?wait=10`, { headers: { "x-rbxmcp-token": "wrong" } })).status).toBe(401);
    expect((await fetch(`${base}/v1/health`)).status).toBe(200);
    expect((await fetch(`${base}/v1/poll?wait=10`, { headers: { "x-rbxmcp-token": "secret" } })).status).toBe(204);
    await http.stop();
  });

  it("rejects a foreign Host header", async () => {
    const { port, http } = await setup();
    expect(await rawGet(port, "/v1/health", { host: "evil.com" })).toBe(400);
    expect(await rawGet(port, "/v1/health", { host: "127.0.0.1" })).toBe(200);
    await http.stop();
  });

  it("dev enqueue route is gated by RBXMCP_DEV", async () => {
    const off = await setup();
    const r1 = await fetch(`${off.base}/v1/_dev/enqueue`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ code: "x" }) });
    expect(r1.status).toBe(404);
    await off.http.stop();

    const on = await setup({ RBXMCP_DEV: "1" });
    const enq = fetch(`${on.base}/v1/_dev/enqueue`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ code: "return 1" }) });
    // act as the plugin
    const poll = await fetch(`${on.base}/v1/poll?wait=2000`);
    const cmd = (await poll.json()).command;
    await fetch(`${on.base}/v1/result`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ commandId: cmd.commandId, ok: true, output: "", returnValues: ["1"], error: null, durationMs: 1 }),
    });
    const enqRes = await enq;
    expect(enqRes.status).toBe(200);
    expect((await enqRes.json()).returnValues).toEqual(["1"]);
    await on.http.stop();
  });
});
