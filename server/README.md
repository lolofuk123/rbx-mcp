# rbx-mcp (server)

The Node/TS package published to npm as **`@lolofuk123/rbx-mcp`**. One process, two faces:

- **MCP side** (stdio) — exposes `execute_lua`, `read_studio_state`, `get_errors`
  to Claude.
- **HTTP side** (`127.0.0.1:30700`) — the Studio plugin long-polls it; correlates
  results back to the awaiting tool call.

On startup it also **auto-installs** the bundled Studio plugin into the local
Plugins folder. See the repo [`README`](../README.md) for the big picture.

## Use with Claude

```json
{
  "mcpServers": {
    "rbx-mcp": { "command": "npx", "args": ["-y", "@lolofuk123/rbx-mcp"] }
  }
}
```

Claude launches the process; you never run a `start` command. Then start/restart
Studio so it loads the auto-installed plugin.

## Environment variables

| Var | Default | Meaning |
|-----|---------|---------|
| `RBXMCP_HOST` | `127.0.0.1` | Bind/connect host (loopback). |
| `RBXMCP_PORT` | `30700` | HTTP port (must match the plugin's Port field). |
| `RBXMCP_TOKEN` | _(unset)_ | Shared secret; if set, the plugin must send it (`X-RbxMcp-Token`). |
| `RBXMCP_POLL_HOLD_MS` | `25000` | Long-poll hold window. |
| `RBXMCP_CMD_TIMEOUT_MS` | `30000` | Default per-command execution budget. |
| `RBXMCP_MAX_RESULT_BYTES` | `1048576` | Max result body size. |
| `RBXMCP_MAX_QUEUE_DEPTH` | `16` | Reject new work past this (fail-fast "busy"). |
| `RBXMCP_AUTOINSTALL` | `on` | Set `off` to skip writing the plugin into the Plugins folder. |
| `RBXMCP_LOG` | `info` | `error` \| `warn` \| `info` \| `debug` (stderr only). |
| `RBXMCP_DEV` | _(unset)_ | `1` enables the dev-only `POST /v1/_dev/enqueue` route. |

## Develop

```bash
npm install
npm test          # vitest (52 tests)
npm run typecheck
npm run build     # bundle plugin -> assets/, then tsc -> dist/
```

### Prove the pipeline without Studio (Milestone A)

Terminal 1 — run the server with the dev route enabled:

```bash
RBXMCP_DEV=1 RBXMCP_AUTOINSTALL=off npm run dev
```

Terminal 2 — enqueue a command (a real plugin, or a fake poller, answers it):

```bash
npm run dev-enqueue -- "return 1 + 1"
```

`GET http://127.0.0.1:30700/v1/health` shows live status (`pluginConnected`,
`queueDepth`, …).

## Manual plugin install

Auto-install covers Windows and macOS. To install by hand (or with
`RBXMCP_AUTOINSTALL=off`), copy [`../plugin/src/rbx-mcp.server.luau`](../plugin/src/rbx-mcp.server.luau)
into the local Plugins folder and restart Studio. See
[`../plugin/README.md`](../plugin/README.md).

## Troubleshooting

- **Plugin not connected** — Studio open? plugin enabled + **Start**ed? HttpService
  allowed? Host/Port/Token match the server?
- **Port in use** — set `RBXMCP_PORT` (and the plugin's Port field) to a free port.
- **Linux** — there's no standard Studio Plugins path; install manually.
