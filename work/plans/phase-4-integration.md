# Phase 4 — Claude Integration, Packaging & Docs

> Wires everything into the real "paste one config block" experience
> (concept §8) and ships it. Implements the Phase-4 glue from [Spec 04 §2/§5](../04-mcp-server.md#2-process-bootstrap--lifecycle-phase-4-glue).
> **Outcome:** Milestone C — a clean install where Claude autonomously runs
> write → run → read → fix loops in Studio.

**Prerequisites:** Phases 1–3 done (Milestones A + B).

---

## Stage 4.1 — End-to-end with real Claude + Studio

- [ ] Register `rbx-mcp` in Claude (Claude Code / app) via the local MCP config block (Spec 04 §5), pointing at the local build first (not yet published).
- [ ] Start Studio with the plugin enabled; confirm `/health` shows `pluginConnected:true`.
- [ ] From Claude: call `execute_lua` to create a Part in `workspace`; verify it appears in Studio.
- [ ] From Claude: call `read_studio_state("selection")` and `("explorer_tree")`; verify sensible output.

**Test 4.1 — E2E smoke checklist (manual, observed)**
- [ ] Create instance → visible in Studio, success result to Claude.
- [ ] Intentional runtime error → Claude receives traceback and **self-corrects on retry** (the core value loop).
- [ ] Timeout (infinite loop code) → Claude gets a `timeout` result, Studio recovers.
- [ ] Plugin disabled mid-session → Claude gets fail-fast "not connected" guidance.

## Stage 4.2 — Plugin bundling + auto-install (the near-one-command win)

- [ ] Bundle `plugin/src/rbx-mcp.server.luau` as a package asset under `server/` (e.g. copy into `server/assets/` at build, list in `files`) with an embedded version stamp.
- [ ] `src/install.ts` — on server boot (Spec 04 §5.2), when `RBXMCP_AUTOINSTALL != off`:
  - [ ] Resolve the OS Plugins path (Windows `%LOCALAPPDATA%/Roblox/Plugins`, macOS `~/Documents/Roblox/Plugins`; skip+log on Linux/unknown).
  - [ ] Write `rbx-mcp.server.luau` if missing or bundled version > installed version.
  - [ ] If same version but checksum differs (user edited it), **skip + log** (never clobber).
  - [ ] Log the action to stderr; failures are non-fatal (server still runs; log guidance to install manually).
- [ ] Wire `install` into the bootstrap before/just after `bridge.start()`.

**Test 4.2**
- [ ] Fresh path (no existing plugin) → file written; correct bytes + version stamp.
- [ ] Newer bundled version → overwrites; same version → no write.
- [ ] User-modified copy at same version → preserved (skip + log).
- [ ] `RBXMCP_AUTOINSTALL=off` → no filesystem write.
- [ ] Unwritable/missing Plugins dir → logs guidance, server continues (non-fatal).
- [ ] Unknown OS → skips cleanly with a log.

## Stage 4.3 — Setup docs (adoption is the product — concept §8)

- [ ] Root `README.md`: the **2-step** setup (paste config block · start/restart Studio), prerequisites (Node, HttpService unless §5.4 spike removes it), troubleshooting (port, token, HttpService off, auto-install path/permissions, manual-install fallback).
- [ ] Document the optional `RBXMCP_PORT`/`RBXMCP_TOKEN`/`RBXMCP_AUTOINSTALL` env + matching plugin fields.
- [ ] GIF/screenshots of the loop (optional, high adoption value).
- [ ] `SECURITY.md`: loopback-only, token, `loadstring` trust model, and that the server writes one file into the Plugins folder (concept §11).

**Test 4.3**
- [ ] Fresh-machine dry run (or clean VM): follow the README verbatim → working in < 5 min, no undocumented step.

## Stage 4.4 — Packaging: npm (Option A)

- [ ] `package.json` finalize: `bin: { "rbx-mcp": "dist/index.js" }`, `files` (incl. bundled plugin asset), `engines.node >=20`, `repository`, `license`, keywords.
- [ ] `prepublishOnly` runs build + tests; ship compiled `dist/` + plugin asset only (no dev route, no `RBXMCP_DEV`).
- [ ] `npm pack` → inspect tarball contents (plugin asset present; dev tooling absent); `npm publish --dry-run`.
- [ ] Verify `npx -y rbx-mcp` works from the packed tarball in a clean dir (the real launch path Claude uses), incl. auto-install firing.

**Test 4.4**
- [ ] `npx` cold start from the tarball boots HTTP + MCP, `/health` ok, MCP Inspector connects, **and** the plugin file lands in the Plugins folder.
- [ ] Dev-only `/v1/_dev/enqueue` route + `RBXMCP_DEV` are absent in the published build.

## Stage 4.5 — Plugin release (manual-install fallback)

- [ ] Attach the standalone `rbx-mcp.server.luau` to the GitHub Release for users who set `RBXMCP_AUTOINSTALL=off` or hit a non-standard Plugins path.
- [ ] Version the plugin (`X-RbxMcp-Plugin`) and note server compatibility (`/v1`); keep it in sync with the bundled asset.

**Test 4.5**
- [ ] Download the released `.luau` on a clean machine, drop it in manually, connect to a published-`npx` server → end-to-end works.

## Stage 4.6 — Release hygiene

- [ ] `CHANGELOG.md` (v0.1.0).
- [ ] Tag `v0.1.0`; GitHub Release (npm link + standalone `.luau`).
- [ ] Confirm the product name before publish (concept §13 — `rbx-mcp` is the concrete id; "RoMCP" is the working title). A rename now is one sweep; after publish it's a breaking npm change.

---

## Definition of Done (Phase 4 / Milestone C)

- [ ] Clean-machine setup works from published `npx` in 2 steps (paste config → restart Studio); auto-install places the plugin.
- [ ] Claude completes an autonomous write → run → read-error → fix → success loop
  in Studio, observed end to end.
- [ ] All Stage 4 smoke checks pass.
- [ ] v0.1.0 published (npm) with the plugin bundled + auto-installed, and the
  standalone `.luau` attached to the GitHub Release.

---

## Post-v1 backlog (parked, from specs' OPEN items)

- [ ] Concurrency beyond one-in-flight (Spec 01 §10, Spec 03 §6).
- [ ] Streaming partial output via MCP progress (Spec 04 §8).
- [ ] Port auto-discovery file (Spec 03 §8).
- [ ] Keep/drop `get_errors` based on real usage (Spec 04 §3.3).
- [ ] Cancel/interrupt tool given Luau's weak interruption story (Spec 04 §8).
- [ ] Auto-enable HttpService from the plugin if the spike (Spec 04 §5.4) confirms it.
- [ ] Option B prebuilt binary distribution (concept §8).
- [ ] Final naming decision (concept §13).
