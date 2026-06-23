# Spec 01 — Wire Protocol (Plugin ↔ Bridge)

> The HTTP contract between the Studio plugin and the bridge process.
> Both [Spec 02 (plugin)](02-studio-plugin.md) and [Spec 03 (bridge HTTP)](03-bridge-http.md)
> implement to this document; it is the single source of truth for the wire.
> Constants (host/port/timeouts/token) live in [README](README.md#cross-cutting-constants).

---

## 1. Roles

- **Bridge = HTTP server.** It binds `127.0.0.1:30700` and owns the queue and
  results store.
- **Plugin = HTTP client.** Studio plugins cannot host a long-lived server, so
  the plugin always initiates: it long-polls for commands and posts results.

All traffic is loopback (`127.0.0.1`) only. No TLS (loopback; certs would add
setup friction for no gain). Optional shared-token auth — see §6.

## 2. Versioning

- All endpoints are under the path prefix **`/v1`**.
- Breaking changes bump the prefix (`/v2`). The plugin sends its build in
  `X-RbxMcp-Plugin` (e.g. `plugin/0.1.0`); the bridge sends `X-RbxMcp-Server`.
- On version mismatch the bridge still serves `/v1` best-effort and logs a
  warning to stderr; it never hard-fails a poll over a minor mismatch.

## 3. Endpoints (overview)

| Method | Path | Caller | Purpose |
|--------|------|--------|---------|
| GET | `/v1/poll` | plugin | Long-poll for the next command. |
| POST | `/v1/result` | plugin | Submit the result of a command. |
| GET | `/v1/health` | plugin / human | Liveness + queue/connection status. |

There is **no** enqueue endpoint: the MCP side enqueues via in-process calls
(same process), not HTTP. See [Spec 03](03-bridge-http.md) and [Spec 04](04-mcp-server.md).

---

## 4. `GET /v1/poll` — long-poll for a command

The plugin calls this in a loop. The bridge responds the moment a command is
available, or after the **long-poll hold** window (`25000` ms) with "nothing".

**Request**

```
GET /v1/poll?clientId=<uuid>&wait=25000 HTTP/1.1
Host: 127.0.0.1:30700
X-RbxMcp-Plugin: plugin/0.1.0
X-RbxMcp-Token: <token>        # only if token auth enabled
```

- `clientId` — stable per Studio session; lets the bridge track one active
  plugin and detect reconnects. Generated once at plugin start (`HttpService:GenerateGUID(false)`).
- `wait` — requested hold in ms; bridge clamps to `[0, RBXMCP_POLL_HOLD_MS]`.

**Response A — a command is ready (`200`)**

```json
{
  "type": "command",
  "command": {
    "commandId": "b1f2…",
    "kind": "execute_lua",
    "code": "return workspace:GetChildren()",
    "timeoutMs": 30000,
    "meta": { "label": "list workspace children" }
  }
}
```

- `kind` — always `execute_lua` in v1 (the universal primitive). Reserved for
  future first-class kinds; the plugin treats unknown kinds as an error result.
- `timeoutMs` — execution budget the plugin SHOULD enforce locally (best-effort;
  Luau can't always interrupt a tight loop — see Spec 02 §risks). The bridge
  enforces its own authoritative timeout regardless.
- `meta` — opaque hints for logging/UI; the plugin never depends on it.

**Response B — nothing to do (`204 No Content`)**

Empty body. The plugin immediately re-polls. This is the normal idle path.

**At-most-one delivery.** A command returned by `/poll` is moved to an
*in-flight* state keyed by `commandId`; it is not handed to another poll. If no
result arrives within the bridge timeout, the bridge fails that command (see
§7) — it does **not** silently redeliver, to avoid double-executing side effects.

---

## 5. `POST /v1/result` — submit a command result

```
POST /v1/result HTTP/1.1
Content-Type: application/json
X-RbxMcp-Token: <token>        # if enabled
```

```json
{
  "commandId": "b1f2…",
  "ok": true,
  "output": "…captured print() text…",
  "returnValues": ["Workspace.Baseplate", "Workspace.Camera"],
  "error": null,
  "durationMs": 12
}
```

Failure example:

```json
{
  "commandId": "b1f2…",
  "ok": false,
  "output": "got here\n",
  "returnValues": null,
  "error": {
    "message": "attempt to index nil with 'Position'",
    "traceback": "stack traceback:\n\t[string \"rbx-mcp\"]:3 …",
    "phase": "runtime"
  },
  "durationMs": 4
}
```

**Field contract**

| Field | Type | Notes |
|-------|------|-------|
| `commandId` | string | MUST match a known in-flight command. |
| `ok` | boolean | `true` iff the chunk compiled and ran without error. |
| `output` | string | Captured `print`/`warn` text (see Spec 02 §capture). May be `""`. |
| `returnValues` | array\|null | Serialized return values (strings). `null` when none/erroring. |
| `error` | object\|null | `{message, traceback, phase}`; `null` when `ok`. `phase ∈ {compile, runtime, timeout, internal}`. |
| `durationMs` | number | Plugin-measured execution time. |

**Responses**

- `200 {"accepted": true}` — stored and correlated to the awaiting MCP call.
- `404 {"error": "unknown commandId"}` — already timed-out/expired; plugin
  discards (the MCP call has already been failed by the bridge).
- `400 {"error": "<reason>"}` — malformed body.

Result bodies have a **size cap** (`RBXMCP_MAX_RESULT_BYTES`, default 1 MiB).
The plugin truncates `output`/`returnValues` before sending and sets
`"truncated": true` (top-level) when it does. See Spec 02 §serialization.

---

## 6. Auth & origin safety

Loopback binding is the primary control. Because *any* local process can reach
loopback, v1 adds an **optional shared token**:

- Enabled when the bridge is started with `RBXMCP_TOKEN` set; the same value is
  entered in the plugin UI (Spec 02).
- Plugin sends it as `X-RbxMcp-Token` on every request.
- Bridge compares with a constant-time check; mismatch → `401`.
- When unset, the bridge runs open (fine for a single-user dev box; the README
  setup recommends setting a token for shared machines).

DNS-rebinding/CSRF from a browser is not a concern for `/poll` and `/result`
(they're not triggered by navigation and require the token when enabled), but
the bridge still **rejects requests whose `Host` header is not** `127.0.0.1`/
`localhost[:port]` as defense-in-depth.

## 7. Timeouts & failure semantics

- **Long-poll hold:** bridge holds `/poll` up to `wait` (≤ `RBXMCP_POLL_HOLD_MS`),
  then `204`. Keeps each request well under Studio's `HttpService` request
  timeout.
- **Command timeout (authoritative):** when a command goes in-flight the bridge
  starts a timer of `timeoutMs` (+ a small grace for transport). If no
  `/result` arrives, the bridge fails the awaiting MCP call with
  `phase: "timeout"` and drops the command. A late `/result` then gets `404`.
- **Plugin disconnect:** if no `/poll` is seen for `> 2 × RBXMCP_POLL_HOLD_MS`,
  `/health` reports `pluginConnected: false`. Any in-flight command still
  follows its own timeout.

## 8. `GET /v1/health`

```json
{
  "status": "ok",
  "bridgeVersion": "0.1.0",
  "queueDepth": 0,
  "inFlight": 0,
  "pluginConnected": true,
  "lastPollAt": "2026-06-23T10:01:02.000Z"
}
```

Used by the plugin UI (to show "connected") and by humans debugging setup. No
auth required for `/health` even when a token is set, but it returns no command
data.

## 9. Sequence (happy path)

```
Claude → MCP.execute_lua(code)
         └─ bridge.enqueue(cmd)            [in-process]
Plugin  → GET /v1/poll  (held open…)
Bridge  → 200 {command}                    (the instant enqueue happened)
Plugin  : loadstring → xpcall → capture
Plugin  → POST /v1/result {ok,output,…}
Bridge  : correlate by commandId → resolve the awaiting promise
MCP     → returns structured result to Claude
```

## 10. OPEN items

- `OPEN` Multiple concurrent commands vs. strict one-at-a-time. v1 proposal:
  **serialize** — the plugin executes one command at a time; the bridge may hold
  a small FIFO queue but only one is in-flight. Revisit if parallelism is needed.
- `OPEN` Binary/large payloads (e.g. returning instance dumps). v1 keeps
  everything JSON+string with the size cap; structured `read_studio_state`
  formatting is defined in Spec 04.
