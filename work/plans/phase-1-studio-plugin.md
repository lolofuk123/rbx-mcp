# Phase 1 — Studio Plugin (Lua)

> Implements [Spec 02](../02-studio-plugin.md) (client side of [Spec 01](../01-wire-protocol.md)).
> Executor logic is already proven by the spike ([`../spikes/loadstring_check.luau`](../spikes/loadstring_check.luau), ✅ 2026-06-23).
> Ships as **one `.luau` file** — no Rojo, no build step (see [Spec 02 §2](../02-studio-plugin.md#2-file-layout--single-file)).
> **Outcome (with Phase 2):** Milestone A — plugin polls the bridge, runs a
> command, reports the result back.

**Prerequisites:** Roblox Studio; a running Phase 2 server to integrate against.
No build toolchain (the `.luau` file is the artifact).

---

## Stage 1.0 — Scaffolding

- [ ] Create `plugin/src/rbx-mcp.server.luau` — a single file, no build tooling.
- [ ] Lay out the internal sections from [Spec 02 §2](../02-studio-plugin.md#2-file-layout--single-file) in dependency order: `[Config]` → `[Serialize]` → `[Executor]` → `[Transport]` → `[Loop]` → `[Ui]` → `[main]`.
- [ ] `selene`/`stylua` config for lint + format (optional but cheap).
- [ ] Install path: drop `rbx-mcp.server.luau` straight into the local Plugins folder (`%LOCALAPPDATA%/Roblox/Plugins` on Windows; `~/Documents/Roblox/Plugins` on macOS). Document in `plugin/README.md`. (The server auto-installs it too — see [Phase 4](phase-4-integration.md).)

**Test 1.0**
- [ ] Dropping `rbx-mcp.server.luau` into the Plugins folder shows a toolbar button after a Studio reload — no build step.

## Stage 1.1 — Config section

- [ ] `[Config]`: read/write `plugin:GetSetting/SetSetting` for `host`, `port`, `token`, `enabled`, `verbose`.
- [ ] Defaults from [README constants](../README.md#cross-cutting-constants); compute `base = "http://"..host..":"..port`.

**Test 1.1**
- [ ] Command-bar harness: set then read settings round-trips; defaults returned when unset.

## Stage 1.2 — Executor section (port the proven spike)

- [ ] `[Executor]`: `Executor.run(code, timeoutMs) -> resultTable`.
  - [ ] Compile with `loadstring(code, "=rbx-mcp")`; on fail return `phase:"compile"`.
  - [ ] Build capturing env (`print`/`warn` → buffer, `__index = getfenv()`); `setfenv(chunk, env)`.
  - [ ] `xpcall(chunk, debug.traceback)`; measure `durationMs` via `os.clock`.
  - [ ] On success: collect + serialize return values. On error: `{message, traceback, phase:"runtime"}`.
  - [ ] Reuse the exact patterns validated in the spike.

**Test 1.2** (command-bar / TestEZ harness `tests/Executor.spec.lua`, calling the exposed `Executor` functions)
- [ ] `return 1+1` → `ok`, returnValues `{"2"}`.
- [ ] `print("hi")` captured into `output`.
- [ ] `error("boom")` → `ok=false`, message + traceback contains `boom`, `phase="runtime"`.
- [ ] `return (` → `ok=false`, `phase="compile"`.
- [ ] Captured output preserved even when the chunk later errors.

## Stage 1.3 — Serialize section

- [ ] `[Serialize]`: `Serialize.value(v) -> string`, total (never throws):
  - [ ] primitives, `Instance` (`GetFullName()` + ClassName), Roblox datatypes via `tostring`.
  - [ ] tables bounded by key count (50) + depth (3), cycle-guarded, `"… (truncated)"`.
  - [ ] functions/userdata → placeholder strings.
- [ ] Result size cap: truncate `output` then `returnValues`, set `truncated=true` over `maxResultBytes`.

**Test 1.3**
- [ ] Each datatype serializes to expected string form.
- [ ] Cyclic table doesn't hang; deep/wide table truncates.
- [ ] Oversized result sets `truncated=true` and stays under cap.

## Stage 1.4 — Transport section

- [ ] `[Transport]` using `HttpService:RequestAsync` (all in `pcall`):
  - [ ] `poll(cfg, clientId)` → `"command"|"idle"|"auth"|"error"`.
  - [ ] `postResult(cfg, result)` → `"accepted"|"unknown"|"error"`.
  - [ ] `health(cfg)` for the UI.
  - [ ] `headers(cfg)` adds `X-RbxMcp-Plugin` and `X-RbxMcp-Token` (if set).
- [ ] HttpService-disabled detection with a clear status message.

**Test 1.4** (integration against the running Phase 2 server)
- [ ] `health` returns `ok` when server up; transport reports error/backoff when down.
- [ ] `poll` returns a command enqueued via `dev-enqueue`; `postResult` gets `accepted`.

## Stage 1.5 — Loop section

- [ ] `[Loop]` state machine (Spec 02 §7): DISABLED→CONNECTING→IDLE→EXECUTING.
  - [ ] One outstanding poll at a time; `task.wait()`-driven.
  - [ ] Capped backoff on error (0.5→1→2→5s); reset on success.
  - [ ] Bounded retry on `postResult` failure, then log + return to IDLE.
  - [ ] Exit cleanly on `plugin.Unloading`.

**Test 1.5**
- [ ] Enable → reaches IDLE against live server; disable → stops, no orphan threads.
- [ ] Kill server mid-run → backs off, recovers when it returns (no Studio crash).

## Stage 1.6 — UI + main wiring

- [ ] `[Ui]`: `DockWidgetPluginGui` with status line (color-coded), Start/Stop toggle, Host/Port/Token fields, last-command summary.
- [ ] `[main]`: create toolbar button, build widget, wire Config/Transport/Executor/Loop/Ui; restore `enabled` to auto-start.
- [ ] Verbose toggle gates Output logging (no idle-poll spam).

**Test 1.6** (manual, observed)
- [ ] Status transitions visible: Disconnected → Connecting → Connected (idle) → Executing.
- [ ] Editing Host/Port/Token persists across Studio restart.
- [ ] HttpService disabled → clear actionable message.

---

## Definition of Done (Phase 1)

- [ ] Executor + Serialize unit tests green (harness).
- [ ] Against a live Phase 2 server: `dev-enqueue "print('hi'); return 1+1"` →
  plugin executes, Output shows `hi`, server receives `ok` + returns `{"2"}`.
- [ ] Spec 02 §11 acceptance items 1–6 all observed.
- [ ] `rbx-mcp.server.luau` is a single drop-in file (no build step) that loads as
  a plugin.
- [ ] **Milestone A reached** (jointly with Phase 2).
