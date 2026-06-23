# Phase 2 — Bridge: HTTP side

> Implements [Spec 03](../03-bridge-http.md) (server side of [Spec 01](../01-wire-protocol.md)).
> **Build this first** — fully testable without Studio.
> **Outcome:** a running localhost bridge + a `dev-enqueue` CLI that, together
> with Phase 1, proves the pipeline (Milestone A).

**Prerequisites:** Node ≥ 20, npm. No Studio needed.

---

## Stage 2.0 — Scaffolding

- [ ] `cd server` and `npm init` → package name `rbx-mcp`, `"type": "module"`.
- [ ] Add TypeScript: `typescript`, `tsx` (dev run), build via `tsc` (or `tsup` for the bin bundle).
- [ ] `tsconfig.json`: `strict: true`, `module/moduleResolution: NodeNext`, `target: ES2022`, `outDir: dist`.
- [ ] Scripts: `dev` (`tsx watch src/index.ts`), `build` (`tsc`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`).
- [ ] Add dev deps only: `vitest`, `@types/node`. (Keep runtime deps at zero for now — built-in `http`.)
- [ ] `src/config.ts` — read + validate + clamp env (`RBXMCP_HOST/PORT/POLL_HOLD_MS/CMD_TIMEOUT_MS/MAX_RESULT_BYTES/TOKEN/LOG`), apply [README defaults](../README.md#cross-cutting-constants), export a frozen `Config`.
- [ ] `src/log.ts` — leveled logger that writes **only to stderr** (Spec 03 §9); honors `RBXMCP_LOG`.

**Test 2.0**
- [ ] `config.test.ts`: defaults applied when env unset; clamping (e.g. `timeoutMs` below floor, above ceiling); invalid port rejected.
- [ ] `log.test.ts`: nothing is ever written to `process.stdout`; level filtering works.

## Stage 2.1 — Core model & queue (no HTTP yet)

- [ ] `src/types.ts` — `Command`, `Result`, `Phase`, `Pending` per [Spec 03 §3](../03-bridge-http.md#3-internal-model).
- [ ] `src/bridge.ts` — `createBridge(config)` exposing the in-process API ([Spec 03 §4](../03-bridge-http.md#4-in-process-api-consumed-by-spec-04)):
  - [ ] internal `queue`, single-slot `inFlight`, `recentErrors` ring buffer (N=20).
  - [ ] `enqueueAndAwait({code,timeoutMs,meta})` → builds `Command` (uuid, clamps timeout), returns a `Promise<Result>`.
  - [ ] **Serialize execution:** if something is in-flight, queue and drain FIFO; one in-flight at a time.
  - [ ] `takeNextCommand()` — pop queue → move to in-flight → arm timeout timer (used by `/poll`).
  - [ ] `submitResult(result)` — correlate by `commandId`, clear timer, resolve promise, push to `recentErrors` if `!ok`; return `accepted | unknown`.
  - [ ] Timeout timer fires → resolve a **synthetic** `Result` with `phase:"timeout"` (Spec 03 §7), drop from in-flight.
  - [ ] `getStatus()` / `getRecentErrors(limit)`.
  - [ ] `maxQueueDepth` (default 16) → `enqueueAndAwait` rejects with "bridge busy" beyond it.

**Test 2.1** (drive the in-process API directly, no sockets)
- [ ] Round-trip: `enqueueAndAwait` resolves with the matching submitted result.
- [ ] FIFO + single in-flight: two enqueues execute strictly in order; second isn't taken until first's result submitted.
- [ ] Timeout: enqueue, never submit → resolves `phase:"timeout"` near `timeoutMs`; later `submitResult` returns `unknown`.
- [ ] `recentErrors` captures failing results up to N, drops oldest.
- [ ] `maxQueueDepth` exceeded → rejects with busy error.

## Stage 2.2 — HTTP server

- [ ] `src/http.ts` — `http.createServer`, bind `config.host:config.port`, tiny path router.
- [ ] **Auth/host guard middleware** (Spec 01 §6): reject foreign `Host` → `400`; if `RBXMCP_TOKEN` set, constant-time compare `X-RbxMcp-Token` → `401` on mismatch (skip for `/health`).
- [ ] `GET /v1/poll`: record `lastPollAt`+`clientId`; if a command is ready return `200 {command}`; else park a **waiter** and resolve `204` after `min(wait, holdMs)` or `200` on enqueue wakeup; clean up waiter on socket close.
- [ ] Enqueue wakeup: `bridge` notifies parked waiters so a `/poll` returns within ms of `enqueueAndAwait` (Spec 03 §6).
- [ ] `POST /v1/result`: parse+validate body → `submitResult`; `200 {accepted:true}` / `404 unknown` / `400 malformed` / `413` over `MAX_RESULT_BYTES`.
- [ ] `GET /v1/health`: return [Spec 01 §8](../01-wire-protocol.md#8-get-v1health) shape from `getStatus()`.
- [ ] Body read with size cap + JSON parse guarded (never throw out of a handler).
- [ ] `pluginConnected` derivation from `lastPollAt` age (> 2× holdMs ⇒ false).

**Test 2.2** (real sockets via `fetch` against an ephemeral port)
- [ ] Long-poll wakeup: park `/poll`, enqueue → response arrives in ms, not after full hold.
- [ ] Idle: `/poll` with empty queue → `204` at ~hold window.
- [ ] Result correlation: `/poll` a command, `POST /result` → awaiting promise resolves; `200 {accepted:true}`.
- [ ] Unknown/expired result → `404`.
- [ ] Malformed body → `400`; oversize body → `413`.
- [ ] Auth: token set → missing/wrong `401`, correct ok; `/health` reachable without token.
- [ ] Host guard: foreign `Host` header → `400`.
- [ ] Health reflects queueDepth/inFlight/pluginConnected/lastPollAt.

## Stage 2.3 — Lifecycle

- [ ] `start()` binds and resolves `{host,port}`; **port-in-use → exit with a clear stderr message naming `RBXMCP_PORT`** (no silent random port).
- [ ] `stop()` on `SIGINT`/`SIGTERM`: stop accepting, reject all pending with shutdown error, close server.
- [ ] Log effective config once at boot (stderr).

**Test 2.3**
- [ ] `stop()` rejects pending tool promises and closes the listener.
- [ ] Second `start()` on the same port fails loudly (spawn two, assert the message).

## Stage 2.4 — Dev tooling (enables Milestone A without MCP)

- [ ] `src/dev-enqueue.ts` — tiny CLI: `tsx src/dev-enqueue.ts "return 1+1"` enqueues via the in-process bridge of a **running** server. (Implementation: a small HTTP `POST /v1/_dev/enqueue` guarded to only exist when `RBXMCP_DEV=1`, OR a separate short-lived client that talks to the same process — pick the dev-only HTTP route; remove from prod build.)
- [ ] Document `curl` recipes for `/health` and a manual result post in `server/README.md`.
- [ ] `server/README.md`: how to run (`npm run dev`), env vars, dev-enqueue usage.

**Test 2.4**
- [ ] With `RBXMCP_DEV=1`, `dev-enqueue` round-trips against a fake poller (script that polls + posts a canned result).
- [ ] Dev route is absent / returns 404 when `RBXMCP_DEV` unset.

---

## Definition of Done (Phase 2)

- [ ] All Stage tests green (`npm test`), typecheck clean.
- [ ] `npm run dev` starts a bridge on `127.0.0.1:30700`; `/health` returns `ok`.
- [ ] Spec 03 §11 acceptance items 1–9 all covered by a passing test.
- [ ] `dev-enqueue` can inject a command and receive a result via the wire — ready
  to point a real Studio plugin at it for **Milestone A**.
