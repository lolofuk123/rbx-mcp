# Security

rbx-mcp runs arbitrary Lua inside Roblox Studio, by design. This documents the
trust model so you can decide whether it fits your environment.

## Trust model

- **`loadstring` executes arbitrary Luau.** The plugin runs whatever code the
  server hands it. Treat the server as fully trusted: anything that can enqueue a
  command can run code in your Studio session. This is the same power as the
  Studio command bar.
- **Local-first, loopback only.** The HTTP server binds `127.0.0.1` and the
  plugin talks only to loopback. No traffic leaves your machine. There is no TLS
  because there is no network hop.
- **Not for untrusted input.** Don't point the bridge at code from sources you
  don't trust, and don't expose the port beyond loopback.

## Controls

- **Loopback binding** is the primary control — remote hosts cannot reach the
  server.
- **Host-header check** rejects requests whose `Host` isn't `127.0.0.1`/`localhost`
  (defense-in-depth against DNS-rebinding-style tricks).
- **Optional shared token** (`RBXMCP_TOKEN`): when set, every plugin request must
  carry `X-RbxMcp-Token` (constant-time compared). Use this on shared machines so
  other local processes can't drive your Studio.

## Filesystem

On startup the server writes **one file** —
`rbx-mcp.server.luau` — into your local Roblox Plugins folder
(`%LOCALAPPDATA%\Roblox\Plugins` on Windows, `~/Documents/Roblox/Plugins` on
macOS). It will not overwrite a copy you've modified at the same version. Disable
this entirely with `RBXMCP_AUTOINSTALL=off`.

## Reporting

This is a pre-release project. Please open an issue for security concerns.
