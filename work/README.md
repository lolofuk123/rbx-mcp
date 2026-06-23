# RoMCP — Component Specs

> Detailed specs for each component of the RoMCP bridge.
> Parent concept doc: [`../PROJECT_CONCEPT_1.md`](../PROJECT_CONCEPT_1.md).
> **Status:** Draft specs / pre-implementation.

These documents turn each component from Section 6 of the concept doc into an
implementable spec. Open questions from the concept are resolved here with
**proposed** decisions; anything still genuinely undecided is flagged
`OPEN` so we can settle it before coding.

---

## How the specs relate

```
                    ┌──────────────────────────────────┐
   Claude ──stdio──▶│  Bridge process (one Node/TS proc)│
   (MCP client)     │                                   │
                    │  04 MCP server  ──in-proc calls──▶ │
                    │       (tools)        03 HTTP bridge│
                    └───────────────────────────┬───────┘
                                                 │  HTTP over 127.0.0.1
                                  01 Wire Protocol│  (the contract)
                                                 ▼
                                    02 Studio Plugin (Lua)
                                                 │
                                                 ▼
                                         Roblox Studio
```

| # | Spec | Roadmap phase | What it covers |
|---|------|---------------|----------------|
| 01 | [Wire Protocol](01-wire-protocol.md) | shared (1+2) | The HTTP contract between plugin and bridge: endpoints, JSON shapes, IDs, errors. Both 02 and 03 depend on it. |
| 02 | [Studio Plugin](02-studio-plugin.md) | Phase 1 | The Lua plugin: poll loop, `loadstring` execution, output/error capture, result reporting, UI. |
| 03 | [Bridge — HTTP side](03-bridge-http.md) | Phase 2 | The localhost HTTP server: command queue, results store, long-polling, correlation, lifecycle. |
| 04 | [Bridge — MCP side](04-mcp-server.md) | Phase 3 | The MCP server: tool definitions (`execute_lua`, `read_studio_state`, `get_errors`), stdio transport, how tools drive the queue. |

Phase 4 (Claude integration / config block) is covered by the **Setup** section
of the concept doc plus the lifecycle section of spec 04; it gets its own spec
only if it grows beyond a config snippet.

**Suggested build order:** 01 → 02 + 03 together (prove the pipeline end to end,
per the concept's first-milestone note) → 04.

---

## Cross-cutting constants

These are shared by multiple components and MUST stay in sync. They live here as
the single source of truth; each spec references them rather than redefining.

| Name | Default | Override | Used by |
|------|---------|----------|---------|
| Bind host | `127.0.0.1` | `RBXMCP_HOST` | bridge (listen), plugin (target) |
| Port | `30700` | `RBXMCP_PORT` | bridge (listen), plugin (target) |
| API path prefix | `/v1` | — | both |
| Long-poll hold | `25000` ms | `RBXMCP_POLL_HOLD_MS` | bridge, plugin |
| Default command timeout | `30000` ms | `RBXMCP_CMD_TIMEOUT_MS` | bridge, MCP tools |
| Pairing token | none (off) | `RBXMCP_TOKEN` + plugin field | both (auth) |
| Token header | `X-RbxMcp-Token` | — | both |
| Plugin auto-install | `on` | `RBXMCP_AUTOINSTALL` | server (writes plugin to Plugins folder) |

**Port note:** `30700` is chosen to avoid Rojo's default `34872`. The plugin and
bridge MUST agree on host+port; if a user changes one they change both. See
spec 02 (UI) and spec 03 (config) for how each reads it.

---

## Cross-cutting decisions (resolving concept Open Questions)

- **Naming:** concrete identifier is **`rbx-mcp`** — npm package, MCP server id,
  `npx` command, plugin file, env prefix `RBXMCP_`, header `X-RbxMcp-`. "RoMCP"
  stays as the human-readable working title in prose (final product name is still
  `OPEN` — concept §13). The folder for the Node package is `server/`; the plugin
  folder is `plugin/`. (We keep the word "bridge" where it describes the role.)
- **Plugin packaging:** a **single `.luau` file** (`rbx-mcp.server.luau`) — no
  Rojo, no build step; the file is both source and shipped artifact (Spec 02 §2).
- **Setup:** the server **auto-installs the plugin** into the local Plugins folder
  on boot (Spec 04 §5), so setup is paste-config-block → restart Studio.
- **Polling model:** **long-polling** (plugin holds a request open up to the
  long-poll hold window; bridge answers the instant a command arrives). Gives
  near-push latency without a server in Studio. See spec 01.
- **Transport split:** the MCP↔bridge boundary is **in-process function calls**,
  not HTTP. Only the plugin↔bridge boundary is HTTP. (One process — concept §5.)
- **MCP transport:** **stdio** (Claude launches via `npx` and speaks stdio).
  Consequence: **stdout is reserved for MCP framing** — all bridge/HTTP logging
  goes to **stderr**. See spec 04.
- **MVP tool set:** `execute_lua` is the primitive; `read_studio_state` and
  `get_errors` are thin conveniences layered on it. See spec 04.

---

## Glossary

- **Command** — one unit of work: a Lua code string + metadata, identified by a
  `commandId`. Enqueued by the MCP side, executed by the plugin.
- **Result** — the plugin's report for one command: ok/err, captured output,
  return values, error message + traceback, duration.
- **Long-poll** — plugin issues a GET that the bridge holds open until a command
  is available or the hold window elapses.
- **Correlation** — matching a Result back to the awaiting MCP tool call via
  `commandId`.
