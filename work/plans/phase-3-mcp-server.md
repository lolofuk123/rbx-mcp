# Phase 3 — Bridge: MCP side

> Implements [Spec 04](../04-mcp-server.md). Layers MCP tools onto the proven
> Phase 2 bridge (in-process calls — no new HTTP).
> **Outcome:** Milestone B — Claude / MCP Inspector calls `execute_lua` and gets
> a structured result.

**Prerequisites:** Phase 2 done (`createBridge`, `enqueueAndAwait`, `getStatus`,
`getRecentErrors`). Same `server/` package.

---

## Stage 3.0 — MCP scaffolding

- [ ] Add runtime dep `@modelcontextprotocol/sdk`.
- [ ] `src/mcp/server.ts` — `createMcpServer(bridge)` returning a configured MCP `Server`.
- [ ] Wire `StdioServerTransport`; confirm **stdout is untouched** by app code (all logs via `src/log.ts` → stderr).
- [ ] Add `bin` entry `rbx-mcp` → `dist/index.js`; `index.ts` bootstrap (Spec 04 §2): `createBridge` → `bridge.start()` (eager) → `createMcpServer` → `server.connect(transport)` → SIGINT/SIGTERM shutdown.

**Test 3.0**
- [ ] Server lists tools via the SDK in-memory client / MCP Inspector.
- [ ] **stdout cleanliness:** capture `process.stdout` during a session → only MCP framing, never log text.
- [ ] Bootstrap starts the HTTP bridge (port bound, `/health` ok) before serving MCP.

## Stage 3.1 — `execute_lua` (the primitive)

- [ ] Register tool with input schema (`code` required, `timeoutMs?`, `label?`) per [Spec 04 §3.1](../04-mcp-server.md#31-execute_lua--the-primitive).
- [ ] Handler: if `getStatus().pluginConnected === false` → **fail-fast** error result with "open Studio / enable RoMCP plugin" guidance.
- [ ] Else `await bridge.enqueueAndAwait({code, timeoutMs, meta:{label}})`.
- [ ] Map `Result` → tool result via shared `toToolResult` (Stage 3.4).

**Test 3.1** (fake/stubbed bridge or real bridge + scripted poller)
- [ ] Success result → `isError:false`, includes output + returns + duration.
- [ ] Error result → `isError:true`, includes phase + message + traceback.
- [ ] Plugin disconnected → fail-fast guidance, no hang.
- [ ] Timeout result mapped to `isError:true`, `phase:"timeout"`.

## Stage 3.2 — `read_studio_state` (curated, server-owned Lua)

- [ ] `src/mcp/snippets.ts` — templated, reviewed Lua for `selection`, `explorer_tree`, `instance`, `services_summary` (Spec 04 §3.2).
- [ ] Validate params (`query` enum; `path` required+sanitized for `instance`; `depth` default 2, clamped).
- [ ] Interpolate validated params into the snippet (no raw user code), run via `enqueueAndAwait`, return serialized output.

**Test 3.2**
- [ ] Each `query` selects the right snippet — assert the generated Lua string.
- [ ] `instance` without `path`, or with an injection-y `path`, → clear validation error (no unescaped interpolation).
- [ ] `depth` clamped to bounds.

## Stage 3.3 — `get_errors`

- [ ] Register `{limit?}` (default 5); return `bridge.getRecentErrors(limit)` mapped to readable text.

**Test 3.3**
- [ ] After N failing executes, returns the last `limit` errors, newest-first.
- [ ] Empty history → empty/explanatory result.

## Stage 3.4 — Result mapping & error surfacing

- [ ] `src/mcp/toToolResult.ts` (Spec 04 §4): success vs. error formatting; `isError` set correctly; error path is info-dense (phase + message + traceback + pre-error output).
- [ ] Map all bridge failure shapes (disconnected / timeout / busy / internal) to clear guidance (Spec 04 §6).

**Test 3.4**
- [ ] Snapshot tests for success and each error phase's rendered text.
- [ ] `isError` true iff `!ok`.

## Stage 3.5 — Shutdown & lifecycle

- [ ] SIGINT/SIGTERM → reject pending tool calls (via `bridge.stop()`), close HTTP, exit 0.
- [ ] MCP client disconnect handled without orphaning the HTTP server.

**Test 3.5**
- [ ] SIGINT during an in-flight tool call → call rejects with shutdown error, process exits cleanly.

---

## Definition of Done (Phase 3)

- [ ] All Stage tests green; typecheck clean.
- [ ] MCP Inspector connects via stdio, lists 3 tools, and an `execute_lua` call
  round-trips through a (real or scripted) plugin.
- [ ] Spec 04 §7 acceptance items 1–8 all covered.
- [ ] `npx` entry (`bin/rbx-mcp`) launches the full process (HTTP + MCP).
- [ ] **Milestone B reached.**
