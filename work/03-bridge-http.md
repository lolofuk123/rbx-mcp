# Spec 03 — Bridge: HTTP side

> Phase 2. The localhost HTTP server inside the bridge process: command queue,
> results store, long-poll handling, correlation, lifecycle. Implements the
> server side of [Spec 01 (wire protocol)](01-wire-protocol.md) and exposes an
> **in-process** API consumed by [Spec 04 (MCP side)](04-mcp-server.md).
> **Stack:** Node.js / TypeScript.

---

## 1. Responsibilities

- Bind `127.0.0.1:30700` and serve `/v1/poll`, `/v1/result`, `/v1/health`.
- Hold a FIFO **command queue** and an **in-flight** + **results** store.
- Resolve long-polls the instant a command is enqueued; otherwise time them out
  to `204`.
- Correlate posted results back to the awaiting in-process caller by `commandId`.
- Enforce command timeouts authoritatively.
- Expose a clean in-process API (`enqueueAndAwait`, `getStatus`, `getRecentErrors`)
  so the MCP layer never touches HTTP.
- Log to **stderr only** (stdout is reserved for MCP stdio framing — see Spec 04).

## 2. Why no framework (proposed)

Use Node's built-in `http` + a tiny hand-rolled router. Rationale: three
endpoints, no middleware ecosystem needed, and `npx` startup stays fast/light
with zero/near-zero deps. (`OPEN`: adopt a micro-framework only if routing grows.)

## 3. Internal model

```ts
type Phase = "compile" | "runtime" | "timeout" | "internal";

interface Command {
  commandId: string;          // uuid v4
  kind: "execute_lua";
  code: string;
  timeoutMs: number;
  meta?: Record<string, unknown>;
}

interface Result {
  commandId: string;
  ok: boolean;
  output: string;
  returnValues: string[] | null;
  error: { message: string; traceback: string; phase: Phase } | null;
  durationMs: number;
  truncated?: boolean;
}

type Pending = {
  command: Command;
  resolve: (r: Result) => void;
  reject: (e: Error) => void;
  enqueuedAt: number;
  timer?: NodeJS.Timeout;     // armed when the command goes in-flight
};
```

Three structures:
- `queue: Command[]` — enqueued, not yet handed to a poll (FIFO).
- `inFlight: Map<commandId, Pending>` — delivered to the plugin, awaiting result.
- `pendingById: Map<commandId, Pending>` — superset bookkeeping for resolve/reject
  (or fold into one map keyed by id with a `state` field). v1 keeps **one
  in-flight at a time** (Spec 01 §10), so these stay tiny.
- `waiters: Array<{res, clientId, timer}>` — held `/poll` responses waiting for a
  command.
- `recentErrors: RingBuffer<Result>` — last N error results for `get_errors`
  (default N=20).

## 4. In-process API (consumed by Spec 04)

```ts
interface Bridge {
  // Enqueue a command and resolve when the plugin returns its result,
  // or reject on timeout/disconnect.
  enqueueAndAwait(input: { code: string; timeoutMs?: number; meta?: object }): Promise<Result>;

  getStatus(): {
    queueDepth: number; inFlight: number;
    pluginConnected: boolean; lastPollAt: string | null;
  };

  getRecentErrors(limit?: number): Result[];

  start(): Promise<{ host: string; port: number }>;  // binds, resolves when listening
  stop(): Promise<void>;                              // drains, rejects pending, closes
}
```

`enqueueAndAwait` is the single primitive the MCP `execute_lua` tool calls.

## 5. Request handling

### 5.1 `GET /v1/poll`
1. Auth + Host checks (Spec 01 §6); `401`/`400` on failure.
2. Record `lastPollAt = now`, remember `clientId` as the active plugin.
3. If `queue` non-empty: shift one command, move to `inFlight`, **arm its
   timeout timer**, respond `200 {type:"command", command}`.
4. Else register a waiter holding the response open; on enqueue, the newest
   waiter is served immediately (see §6). After `min(wait, holdMs)` with no
   command, respond `204` and drop the waiter.
5. If the connection closes early (plugin gone), remove the waiter; no error.

### 5.2 `POST /v1/result`
1. Auth check.
2. Parse + validate body against the `Result` contract; `400` on malformed.
3. Look up `inFlight.get(commandId)`:
   - **hit** → clear its timer, delete from `inFlight`, push to `recentErrors`
     if `!ok`, `resolve(result)`, respond `200 {accepted:true}`.
   - **miss** → already timed out/expired → `404 {error:"unknown commandId"}`.
4. Server-side size guard: if body exceeds `RBXMCP_MAX_RESULT_BYTES`, reject `413`
   (the plugin should have truncated first; this is a backstop).

### 5.3 `GET /v1/health`
Return the [Spec 01 §8](01-wire-protocol.md#8-get-v1health) shape from `getStatus()`.
No auth gate, no command data.

## 6. Long-poll wakeup

On `enqueueAndAwait`:
1. Build `Command` (uuid, clamp `timeoutMs` to `[1000, RBXMCP_CMD_TIMEOUT_MS_MAX]`,
   default `RBXMCP_CMD_TIMEOUT_MS`).
2. If a waiter is parked → hand the command straight to it (skip the queue),
   move to `inFlight`, arm timer.
3. Else push to `queue` (it'll be picked up by the next `/poll`).
4. Return the promise; store `resolve/reject` in the pending record.

Because v1 serializes execution, `enqueueAndAwait` also **awaits a free slot**:
if something is already in-flight, queue the new command and let it drain in
order. (`OPEN`: a `maxQueueDepth` to fail-fast instead of unbounded queueing —
propose default 16, reject with a clear "bridge busy" error beyond it.)

## 7. Timeouts & failure

- **Command timeout:** armed when in-flight. On fire: delete from `inFlight`,
  `reject(new TimeoutError())` (or resolve a synthetic `Result` with
  `phase:"timeout"` — **proposed: resolve a synthetic error Result** so the MCP
  tool returns a normal structured error instead of throwing, keeping Claude's
  loop uniform). Push to `recentErrors`. A later `/result` for it gets `404`.
- **Plugin disconnect:** derived from `lastPollAt` age (Spec 01 §7). Reflected in
  `getStatus().pluginConnected`. In-flight commands still honor their own timeout.
- **No plugin ever connects:** `enqueueAndAwait` simply waits for the command
  timeout and returns a timeout error — the MCP tool can tell Claude "Studio
  plugin isn't connected" by also checking `pluginConnected` (Spec 04).

## 8. Lifecycle

- `start()` is called once by the process bootstrap (Spec 04 §lifecycle) before
  MCP registration, or lazily on first tool call — **proposed: eager start** at
  process boot so `/health` works immediately for setup debugging.
- **Port-in-use:** if `30700` is taken, fail with a clear stderr message naming
  `RBXMCP_PORT`; do **not** silently pick a random port (the plugin wouldn't find
  it). (`OPEN`: optional auto-increment + write chosen port to a discovery file
  the plugin could read — deferred; manual config is fine for v1.)
- `stop()` on `SIGINT`/`SIGTERM`/MCP shutdown: stop accepting, reject all pending
  with a shutdown error, close the server, resolve.

## 9. Logging & observability

- All logs → **stderr** (never stdout). Levels via `RBXMCP_LOG` (`error|warn|info|debug`,
  default `info`).
- Log: bind address, each enqueue (id + label + code length), delivery, result
  (ok/err + duration), timeouts, auth failures, disconnect transitions.
- Never log full code/output at `info` (could be large/sensitive); gate at `debug`.

## 10. Config

All from env, defaults in [README constants](README.md#cross-cutting-constants):
`RBXMCP_HOST`, `RBXMCP_PORT`, `RBXMCP_POLL_HOLD_MS`, `RBXMCP_CMD_TIMEOUT_MS`,
`RBXMCP_MAX_RESULT_BYTES`, `RBXMCP_TOKEN`, `RBXMCP_LOG`. Validate/clamp on start;
log the effective config once at boot.

## 11. Tests (Phase 2 acceptance)

Unit + integration against the HTTP surface (no Studio needed — drive the plugin
side with `fetch`/`supertest`):

1. **Round-trip:** `enqueueAndAwait({code})` resolves with the `Result` posted to
   `/result`, correlated by id.
2. **Long-poll wakeup:** a `/poll` parked before enqueue returns the command
   within ms of enqueue (not after the full hold).
3. **Idle:** `/poll` with no command returns `204` at ~hold window.
4. **Timeout:** enqueue, never post a result → promise resolves as
   `phase:"timeout"` at ~`timeoutMs`; subsequent `/result` gets `404`.
5. **Serialization order:** two enqueues run strictly FIFO, one in-flight at a time.
6. **Auth:** with `RBXMCP_TOKEN` set, missing/wrong token → `401`; correct → ok.
7. **Host guard:** request with foreign `Host` header → `400`.
8. **Health:** reflects queueDepth/inFlight/pluginConnected/lastPollAt correctly.
9. **Lifecycle:** `stop()` rejects pending and closes; port-in-use fails loudly.
