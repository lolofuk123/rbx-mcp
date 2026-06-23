# RoMCP — Implementation Plan (Master)

> Execution plan for building RoMCP, split into the four roadmap phases.
> Specs: [`../01-wire-protocol.md`](../01-wire-protocol.md) ·
> [`../02-studio-plugin.md`](../02-studio-plugin.md) ·
> [`../03-bridge-http.md`](../03-bridge-http.md) ·
> [`../04-mcp-server.md`](../04-mcp-server.md).
> Viability spike: ✅ passed 2026-06-23 ([`../spikes/loadstring_check.luau`](../spikes/loadstring_check.luau)).

Each phase has its own plan file with granular, checkboxed tasks and a tests
section. Check boxes off as you go; the phase is done when its **Definition of
Done** is met.

## Phase plans

| Phase | Plan | Component | Can build without Studio? |
|-------|------|-----------|---------------------------|
| 1 | [phase-1-studio-plugin.md](phase-1-studio-plugin.md) | Studio Plugin (Lua) | No — needs Studio |
| 2 | [phase-2-bridge-http.md](phase-2-bridge-http.md) | Bridge HTTP side (Node/TS) | **Yes** — fully testable headless |
| 3 | [phase-3-mcp-server.md](phase-3-mcp-server.md) | Bridge MCP side (Node/TS) | Yes — testable with a fake plugin |
| 4 | [phase-4-integration.md](phase-4-integration.md) | Claude integration, packaging, docs | No — needs Studio + Claude |

## Milestones

- [ ] **Milestone A — Pipeline proven** (Phase 1 + Phase 2): a command injected
  via the dev CLI runs in Studio and its result returns through the bridge.
  *This is the concept's suggested first milestone — prove the loop before MCP.*
- [ ] **Milestone B — MCP exposed** (Phase 3): Claude (or MCP Inspector) calls
  `execute_lua` and gets a structured result.
- [ ] **Milestone C — Claude integrated** (Phase 4): paste-one-config-block
  setup works; Claude runs an autonomous write → run → read → fix loop in Studio.

## Recommended execution order

1. **Phase 2 first.** It's the only piece fully buildable + testable here without
   Studio in the loop, and it gives the plugin something to poll. Its
   `dev-enqueue` CLI lets us prove the pipeline *before* Phase 3 exists.
2. **Phase 1 next**, tested live against the running Phase 2 bridge → hits
   Milestone A.
3. **Phase 3** layers MCP tools onto the proven bridge → Milestone B.
4. **Phase 4** wires Claude, packages, documents → Milestone C.

Phases 1 and 2 can proceed in **parallel** by two people (the wire protocol in
[Spec 01](../01-wire-protocol.md) is the contract that lets them integrate), but
solo, do Phase 2 first.

## Conventions

- **Repo layout (proposed):**
  ```
  /server        Node/TS package (Phases 2 & 3), published to npm as `rbx-mcp`;
                 bundles the plugin file and auto-installs it on boot
  /plugin        single-file Lua plugin (Phase 1): src/rbx-mcp.server.luau
                 (no build step — the .luau IS the artifact)
  /work          specs + plans (this dir)
  ```
- **Checkbox states:** `- [ ]` todo · `- [x]` done · `- [~]` in progress (optional).
- **Test mapping:** each phase's test tasks mirror the acceptance tests in its
  spec (Spec 02 §11, Spec 03 §11, Spec 04 §7) so "all tests checked" == "spec
  acceptance met".
- **No task is done until its test is green** (or, for manual Studio steps,
  observed and noted).

## Cross-phase setup (do once, up front)

- [ ] Create `/server` and `/plugin` top-level dirs.
- [ ] Add root `README.md` pointing at `work/` (separate from the npm package README).
- [ ] Add `.gitignore` (node_modules, `dist/` build output, `.env`). The plugin
  `.luau` is source, not a build artifact — do **not** ignore it.
- [ ] Decide license + add `LICENSE` (concept §10 mentions OSS core).
- [ ] Pin Node version (`.nvmrc` / `engines` in package.json — propose Node ≥ 20).
