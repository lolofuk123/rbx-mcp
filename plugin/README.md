# rbx-mcp — Studio plugin

A single-file Roblox Studio plugin. It polls the local `rbx-mcp` server, runs the
Lua it's handed via `loadstring()`, and reports output / return values / errors
back. There is **no build step** — the `.luau` file *is* the plugin.

## Install

You normally don't install this by hand: when you run the `rbx-mcp` server
(via Claude's MCP config), it **auto-installs** this file into your local Plugins
folder. See the repo [`README`](../README.md).

To install manually (or if you set `RBXMCP_AUTOINSTALL=off`):

1. Copy the plugin into your local Plugins folder **as `rbx-mcp.lua`**
   (Studio's loose-file plugin loader only picks up the `.lua` extension, not
   `.luau`). Use the built `server/assets/rbx-mcp.lua`, or copy
   [`src/rbx-mcp.server.luau`](src/rbx-mcp.server.luau) and rename it to `rbx-mcp.lua`.
   - **Windows:** `%LOCALAPPDATA%\Roblox\Plugins`
   - **macOS:** `~/Documents/Roblox/Plugins`
2. Restart Roblox Studio.
3. Enable **HttpService** (Game Settings → Security → *Allow HTTP Requests*).
4. Click the **rbx-mcp** toolbar button to open the panel, then **Start**.

## Panel

- **Status** — Disconnected / Connecting / Connected (idle) / Executing / errors.
- **Host / Port / Token** — must match the server (defaults `127.0.0.1` / `30700`,
  token only if the server sets `RBXMCP_TOKEN`). Saved across sessions.
- **Start / Stop** — toggles the poll loop. The plugin re-starts automatically
  next session if it was running.

## Tests

`tests/executor.spec.luau` is a command-bar test harness mirroring the Phase 1
acceptance checks (Spec 02 §11): `loadstring` compile/runtime paths, `print`
capture, and traceback fidelity. Paste it into the Studio Command Bar and read
the `VERDICT` line. (Studio is required — there's no headless Luau runner here.)
