# rbx-mcp

> Let an AI agent (Claude) write Lua and execute it **live inside Roblox Studio**,
> read the result, and iterate — over the Model Context Protocol.

`rbx-mcp` is a small bridge with two halves in one process:

- an **MCP server** (stdio) that exposes Studio actions to Claude as tools
  (`execute_lua`, `read_studio_state`, `get_errors`), and
- a **localhost HTTP server** that a tiny Roblox Studio plugin polls — it runs
  the Lua via `loadstring()` and reports back output, return values, and errors
  (with tracebacks).

The plugin is deliberately *dumb and universal*: it just runs whatever Lua it's
given, so it never needs updating for new tasks. All the intelligence stays on
the AI side.

## Status

Pre-release. Design docs and the phased build plan live in [`work/`](work/);
start with [`work/README.md`](work/README.md) and the concept doc
[`PROJECT_CONCEPT_1.md`](PROJECT_CONCEPT_1.md).

## Repo layout

```
server/   Node/TS package, published to npm as `rbx-mcp`
          (MCP side + localhost HTTP side; bundles & auto-installs the plugin)
plugin/   single-file Studio plugin: src/rbx-mcp.server.luau (no build step)
work/     specs + implementation plan
```

## Setup

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 20, Roblox Studio, and an
MCP-capable AI host (see below). rbx-mcp is **model-agnostic** — bring Claude,
GPT, or any model your host drives; the server only exposes MCP tools, the model
just calls them. The host must run a **local stdio** server on the **same
machine as Studio** (the plugin talks to `localhost`).

### 1. Add the MCP server to your AI host

**Claude Desktop / Claude Code** — top-level key `mcpServers`:
```json
{
  "mcpServers": {
    "rbx-mcp": { "command": "npx", "args": ["-y", "@lolofuk123/rbx-mcp"] }
  }
}
```
- **Claude Desktop:** `%APPDATA%\Claude\claude_desktop_config.json` (Windows) /
  `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).
- **Claude Code:** `.mcp.json` at the project root, or `claude mcp add rbx-mcp -- npx -y @lolofuk123/rbx-mcp`.

**VS Code / GitHub Copilot** (agent mode) — note the different key (`servers`) and
`type`. File `.vscode/mcp.json` (or Command Palette → **MCP: Add Server**):
```json
{
  "servers": {
    "rbx-mcp": { "type": "stdio", "command": "npx", "args": ["-y", "@lolofuk123/rbx-mcp"] }
  }
}
```
(Cursor / Windsurf are similar — e.g. `.cursor/mcp.json`, same `mcpServers` shape as Claude.)

### 2. Open Roblox Studio

On first launch the server **auto-installs the plugin** into your local Plugins
folder; Studio loads it on (re)start. Then open the **rbx-mcp** panel → click
**Start**. If HttpService is off, the panel tells you exactly where to enable it
(Experience settings → Security → Allow HTTP Requests); it connects automatically
once you do.

That's it. See [`server/README.md`](server/README.md) for env vars, an optional
auth token, and manual plugin install.

## Troubleshooting

**VS Code / Copilot (Windows):**
- **MCP tools don't appear / no "Start" shows up** — MCP tools only work in
  Copilot **Agent mode** (not Ask/Edit). Start the server via Command Palette →
  **MCP: List Servers** → `rbx-mcp`, and enable it in the chat's 🔧 **Tools** picker.
- **`node`/`npx` "not recognized" in VS Code's terminal** (but fine in a normal
  terminal) — VS Code launched with a stale PATH from *before* Node was installed.
  **Fully quit and reopen VS Code** (reboot if it persists) so it picks up Node.
- **`spawn npx ENOENT`** when starting the server — on Windows `npx` is actually
  `npx.cmd`, which VS Code's direct spawn can miss. Wrap it in `cmd`:
  ```json
  {
    "servers": {
      "rbx-mcp": { "type": "stdio", "command": "cmd", "args": ["/c", "npx", "-y", "@lolofuk123/rbx-mcp"] }
    }
  }
  ```
  (or set `"command": "npx.cmd"`).

**Roblox Studio:**
- **No rbx-mcp toolbar button after install** — fully restart Studio; it only
  scans the Plugins folder at launch. (The installed file must be `.lua`, which
  the auto-installer handles.)
- **Stuck on "HTTP service disabled"** — enable it (Experience settings → Security
  → Allow HTTP Requests); the plugin connects automatically once it's on.
- **`pluginConnected: false` in `/v1/health`** — open the rbx-mcp panel and click
  **Start**; check Host/Port (and Token, if set) match the server.

## Development

```bash
cd server
npm install
npm test          # vitest
npm run build     # tsc -> dist/
npm run dev       # run the server locally (stdio MCP + HTTP on 127.0.0.1:30700)
```

## License

See [`LICENSE`](LICENSE).
