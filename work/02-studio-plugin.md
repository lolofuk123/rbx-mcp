# Spec 02 — Studio Plugin (Lua)

> Phase 1. The "dumb, universal" plugin: poll for a command, run it with
> `loadstring`, capture what happened, report back. Implements the client side
> of [Spec 01 (wire protocol)](01-wire-protocol.md).
> **Target size:** ~150–300 lines of Luau in one organized file.

---

## 1. Responsibilities (and non-responsibilities)

**Does:**
- Long-poll the bridge for commands.
- Compile + execute Lua via `loadstring`, capturing output, return values, and
  errors (with traceback).
- Report a structured result per [Spec 01 §5](01-wire-protocol.md#5-post-v1result--submit-a-command-result).
- Show connection status and let the user start/stop and set host/port/token.

**Does not:**
- Interpret commands, build features, or know anything task-specific. Every
  capability is "different Lua" supplied by Claude.
- Persist anything across Studio sessions beyond plugin settings.
- Talk to Anthropic or the MCP layer directly — only to the local bridge.

## 2. File layout — single file

The plugin ships as **one `.luau` file**, `rbx-mcp.server.luau`, which is both
the source and the distributed artifact (no build step, no Rojo). Because the
file *is* the artifact, the server can auto-install it into the local Plugins
folder on startup (see [Spec 04 §5](04-mcp-server.md)) — the key to
near-one-command setup.

It's organized into clearly-commented internal sections (not separate
ModuleScripts), in dependency order:

```
rbx-mcp.server.luau
  -- [Config]    read/write plugin settings (host, port, token, enabled)
  -- [Serialize] total, never-throws  value -> string
  -- [Executor]  loadstring + env + xpcall + capture + serialize
  -- [Transport] HttpService calls: poll(), postResult(), health()
  -- [Loop]      poll -> execute -> report state machine
  -- [Ui]        DockWidget: status, start/stop, settings fields
  -- [main]      toolbar button, widget, wiring, Unloading cleanup
```

Sections share state via locals/upvalues. `Executor` and `Serialize` are written
as plain functions so the command-bar test harness can call them directly (§11).
Multi-module via Rojo was considered and rejected: it adds a build toolchain for
no user-facing benefit and complicates auto-install. Section names used below
(Config, Transport, …) refer to these in-file sections.

## 3. Prerequisites & platform checks

- **HttpService enabled.** `HttpService.HttpEnabled` must be `true`
  (Game Settings → Security, or `game:GetService("HttpService").HttpEnabled = true`).
  On start the plugin checks it and, if off, shows a clear UI message with the
  fix rather than silently failing.
- **`loadstring` availability.** `loadstring` is gated by
  `ServerScriptService.LoadStringEnabled` for the **in-experience server VM**.
  Plugins run in a **plugin security context**, where `loadstring` is available
  independent of that game setting. ✅ **VERIFIED 2026-06-23** via
  [`spikes/loadstring_check.luau`](spikes/loadstring_check.luau) — `loadstring`
  is present and runs in this Studio; no `LoadStringEnabled` setup step needed.
- **Loopback HTTP allowed.** Studio permits `HttpService` requests to
  `localhost`/`127.0.0.1` (this is exactly what Rojo relies on). No external
  domain allow-listing needed.

## 4. Transport (`Transport.lua`)

Use `HttpService:RequestAsync` (gives status code + headers, unlike
`GetAsync`/`PostAsync`). All calls wrapped in `pcall` — network errors must
never crash the loop.

```lua
function Transport.poll(cfg, clientId)
    local res = HttpService:RequestAsync({
        Url = cfg.base .. "/v1/poll?clientId=" .. clientId .. "&wait=" .. cfg.holdMs,
        Method = "GET",
        Headers = Transport.headers(cfg),  -- X-RbxMcp-Plugin, X-RbxMcp-Token?
    })
    if res.StatusCode == 200 then
        return "command", HttpService:JSONDecode(res.Body).command
    elseif res.StatusCode == 204 then
        return "idle"
    elseif res.StatusCode == 401 then
        return "auth"
    else
        return "error", res.StatusCode
    end
end
```

- `cfg.base = "http://" .. host .. ":" .. port`.
- `postResult(cfg, result)` → `POST /v1/result`, JSON body, returns accepted/404/400.
- `health(cfg)` → `GET /v1/health` for the UI status indicator.
- **Backoff:** on connection-refused/error, the loop waits with capped backoff
  (e.g. 0.5s → 1s → 2s → max 5s) before re-polling, so a not-yet-started bridge
  doesn't spin. Reset to fast polling on first success.

## 5. Execution & capture (`Executor.lua`) — the core

This is where the value lives: faithful output and error capture is what makes
Claude's iterate-on-error loop work (concept §11).

### 5.1 Compile

```lua
local chunk, compileErr = loadstring(code, "=rbx-mcp")  -- chunk name shows in tracebacks
if not chunk then
    return { ok = false, output = "", returnValues = nil,
             error = { message = compileErr, traceback = compileErr, phase = "compile" } }
end
```

### 5.2 Output capture via a custom environment

Replace `print`/`warn` with capturing versions in the chunk's environment, while
falling through to all normal globals. In Luau, set the chunk's environment with
`setfenv(chunk, env)` where `env` has `__index` to the real globals.

```lua
local buffer = {}
local function capture(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[i] = tostring(select(i, ...)) end
    table.insert(buffer, table.concat(parts, "\t"))
end

local env = setmetatable({
    print = capture,
    warn  = function(...) capture("[warn]", ...) end,
}, { __index = getfenv() })   -- real game, workspace, services, etc. fall through
setfenv(chunk, env)
```

Captured text is `table.concat(buffer, "\n")`. (Note: real `print` still also
goes to the Studio Output window; we add capture, we don't suppress — handy for
the user watching live.)

### 5.3 Run with traceback

```lua
local t0 = os.clock()
local results = table.pack(xpcall(chunk, function(err)
    return debug.traceback(tostring(err), 2)
end))
local durationMs = math.floor((os.clock() - t0) * 1000 + 0.5)

local okFlag = results[1]
if okFlag then
    local returnValues = {}
    for i = 2, results.n do returnValues[i - 1] = Serialize.value(results[i]) end
    return { ok = true, output = concat(buffer), returnValues = returnValues,
             error = nil, durationMs = durationMs }
else
    return { ok = false, output = concat(buffer), returnValues = nil,
             error = { message = stripTraceback(results[2]), traceback = results[2],
                       phase = "runtime" }, durationMs = durationMs }
end
```

### 5.4 Local timeout (best-effort)

Luau cannot reliably interrupt a tight CPU loop from outside. v1 approach:
- Run the chunk directly (synchronous) and rely on the **bridge's authoritative
  timeout** ([Spec 01 §7](01-wire-protocol.md#7-timeouts--failure-semantics)) to
  fail the MCP call if the plugin is stuck.
- `OPEN`: optionally run via `task.spawn` + a watchdog that reports a
  `phase: "timeout"` result if execution exceeds `timeoutMs`, accepting that the
  runaway thread may keep running until it yields. Document the limitation
  rather than pretend we can hard-kill it.

## 6. Serialization (`Serialize.value`)

Return values and printed objects must become JSON-safe strings without throwing.

- `nil/boolean/number/string` → as-is (numbers/bools become themselves; strings
  pass through; the wire field is an array of strings, so coerce with `tostring`
  but keep numbers/bools faithful in text).
- `Instance` → `instance:GetFullName()` plus `ClassName`, e.g.
  `"Workspace.Baseplate (Part)"`.
- `Vector3/Color3/CFrame/UDim2/Enum…` → `tostring(value)` (Roblox gives readable
  forms).
- `table` → shallow/bounded pretty form: serialize up to **N keys** and **depth D**
  (defaults: 50 keys, depth 3), then append `"… (truncated)"`. Guard against
  cycles with a visited set.
- Functions/userdata without a string form → `"<function>"` / `"<userdata>"`.
- Enforce the result size cap ([Spec 01 §5](01-wire-protocol.md#5-post-v1result--submit-a-command-result)):
  if the assembled body exceeds `maxResultBytes`, truncate `output` first, then
  `returnValues`, and set top-level `truncated = true`.

Keep this conservative and total (never errors) — a serializer that throws would
swallow the real result.

## 7. Poll loop (`Loop.lua`)

A simple state machine driven by the toolbar toggle:

```
DISABLED ──(user enables)──▶ CONNECTING
CONNECTING ──poll ok──▶ IDLE        ──poll error──▶ BACKOFF ──▶ CONNECTING
IDLE ──command──▶ EXECUTING ──result posted──▶ IDLE
EXECUTING ──post fails──▶ retry post (bounded), else log & return to IDLE
any ──(user disables / plugin unloading)──▶ DISABLED
```

- One outstanding poll at a time; never overlap polls.
- Drive with a loop using `task.wait()`; long-poll means the HTTP call itself
  blocks ~hold window, so the effective poll cadence is low-overhead.
- On `plugin.Unloading`, set a flag so the loop exits cleanly (no orphaned
  threads, no requests after teardown).
- Surface every transition to the UI status line and to Output (gated behind a
  verbose toggle).

## 8. UI (`Ui.lua`) — minimal

A `DockWidgetPluginGui` with a toolbar button, holding:
- **Status line:** Disconnected / Connecting / Connected (idle) / Executing /
  Auth failed / HttpService disabled — color-coded.
- **Toggle:** Start / Stop the loop.
- **Settings fields:** Host (default `127.0.0.1`), Port (default `30700`),
  Token (optional, masked). Persisted via `plugin:SetSetting`/`GetSetting`.
- **Last command:** id + ok/err + duration, for at-a-glance debugging.

No more than this for v1 (concept §4 non-goal: no polished GUI).

## 9. Settings persistence (`Config.lua`)

- Read on load: `plugin:GetSetting("rbx-mcp.host" | "rbx-mcp.port" | "rbx-mcp.token" | "rbx-mcp.enabled")`.
- Defaults from [README constants](README.md#cross-cutting-constants).
- Write on field change. `enabled` remembers whether to auto-start the loop next
  session.

## 10. Risks & verification checklist

- ✅ **`loadstring` in plugin context** — VERIFIED 2026-06-23 (spike: ALL PASS).
  Works without `LoadStringEnabled`. Was the single biggest "does the whole thing
  work" assumption; now cleared.
- ✅ **`setfenv` on a `loadstring` chunk in current Luau** — VERIFIED 2026-06-23
  (spike: ALL PASS). `getfenv`/`setfenv` print-capture + `xpcall` +
  `debug.traceback` all behave as the spec assumes. Fallback (inject `print` via
  `_ENV`/string-prefix) is therefore **not needed**, kept here only as a record.
- **`HttpService` request timeout** — keep the long-poll hold (25s) safely under
  it; verify Studio doesn't abort the held request earlier.
- **Output window noise** — the poll loop must not spam Output; gate logs behind
  a verbose flag.
- **Result size** — large workspace dumps can exceed limits; the serializer cap
  (§6) and the wire size cap (Spec 01 §5) must both hold.

## 11. Done-when (Phase 1 acceptance)

Driven manually against a stub bridge (or `curl`-backed fake):
1. Enabling the plugin shows **Connected** when the bridge is up, **Disconnected**
   with backoff when it isn't.
2. A queued `return 1 + 1` yields a result with `ok:true`, `returnValues:["2"]`.
3. `print("hi")` is captured into `output`.
4. A runtime error (`error("boom")`) yields `ok:false` with a message **and** a
   traceback.
5. A compile error (`return (`) yields `ok:false`, `phase:"compile"`.
6. Killing the bridge mid-run doesn't crash Studio; the loop backs off and
   recovers when the bridge returns.
