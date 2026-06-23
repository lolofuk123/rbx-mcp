import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Config } from "./config.js";
import type { Logger } from "./log.js";
import type { Bridge } from "./bridge.js";
import { isValidResultBody } from "./types.js";

export interface HttpServer {
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
}

const BODY_TOO_LARGE = Symbol("too-large");

export function createHttpServer(bridge: Bridge, config: Config, log: Logger): HttpServer {
  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error("unhandled request error", { message: (err as Error).message });
      if (!res.headersSent) fail(res, 500, "internal error");
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${config.host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Defense-in-depth: only serve loopback Host headers.
    if (!hostAllowed(req.headers.host)) return fail(res, 400, "bad host");

    // /health is always reachable (no command data, no auth) so setup debugging works.
    if (method === "GET" && path === "/v1/health") {
      return json(res, 200, bridge.getStatus());
    }

    if (config.token !== null && !checkToken(req, config.token)) {
      return fail(res, 401, "unauthorized");
    }

    if (method === "GET" && path === "/v1/poll") {
      const clientId = url.searchParams.get("clientId") ?? undefined;
      const waitRaw = Number(url.searchParams.get("wait"));
      const wait = Number.isFinite(waitRaw) ? waitRaw : config.pollHoldMs;
      const command = await bridge.waitForCommand(wait, clientId);
      if (command === null) {
        res.writeHead(204).end();
        return;
      }
      return json(res, 200, { type: "command", command });
    }

    if (method === "POST" && path === "/v1/result") {
      const body = await readBody(req, config.maxResultBytes);
      if (body === BODY_TOO_LARGE) return fail(res, 413, "result too large");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return fail(res, 400, "invalid json");
      }
      if (!isValidResultBody(parsed)) return fail(res, 400, "invalid result body");
      // Normalize omitted (undefined) fields to null so downstream Result objects are well-formed.
      const outcome = bridge.submitResult({
        commandId: parsed.commandId,
        ok: parsed.ok,
        output: parsed.output,
        returnValues: parsed.returnValues ?? null,
        error: parsed.error ?? null,
        durationMs: parsed.durationMs,
        truncated: parsed.truncated,
      });
      if (outcome === "unknown") return fail(res, 404, "unknown commandId");
      return json(res, 200, { accepted: true });
    }

    // Dev-only enqueue route — present solely when RBXMCP_DEV is set. Stripped from prod.
    if (config.dev && method === "POST" && path === "/v1/_dev/enqueue") {
      const body = await readBody(req, config.maxResultBytes);
      if (body === BODY_TOO_LARGE) return fail(res, 413, "too large");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return fail(res, 400, "invalid json");
      }
      const obj = parsed as Record<string, unknown>;
      if (typeof obj?.code !== "string") return fail(res, 400, "missing code");
      try {
        const result = await bridge.enqueueAndAwait({
          code: obj.code,
          timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : undefined,
          meta: { label: typeof obj.label === "string" ? obj.label : "dev-enqueue" },
        });
        return json(res, 200, result);
      } catch (err) {
        return fail(res, 503, (err as Error).message);
      }
    }

    return fail(res, 404, "not found");
  }

  function start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(
            new Error(
              `port ${config.port} on ${config.host} is already in use. ` +
                `Set RBXMCP_PORT to a free port (and match it in the Studio plugin).`,
            ),
          );
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(config.port, config.host, () => {
        server.removeListener("error", onError);
        const addr = server.address() as AddressInfo;
        log.info("http listening", { host: config.host, port: addr.port });
        resolve({ host: config.host, port: addr.port });
      });
    });
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      server.close(() => resolve());
      // Don't let lingering keep-alive sockets block close.
      server.closeAllConnections?.();
    });
  }

  return { start, stop };
}

function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}

function checkToken(req: IncomingMessage, expected: string): boolean {
  const got = req.headers["x-rbxmcp-token"];
  const value = Array.isArray(got) ? got[0] : got;
  if (typeof value !== "string") return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string | typeof BODY_TOO_LARGE> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (!done && size > maxBytes) {
        done = true;
        resolve(BODY_TOO_LARGE);
      }
      // Keep consuming (to drain the socket) but stop buffering once over the cap.
      if (!done) chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function fail(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}
