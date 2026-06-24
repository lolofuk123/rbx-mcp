# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## [Unreleased]

### Added — initial implementation (v0.1.0, pre-release)

- **Server (`rbx-mcp`, Node/TS):**
  - localhost HTTP bridge (`/v1/poll`, `/v1/result`, `/v1/health`) with
    long-polling, single-in-flight execution, command/result correlation, and an
    authoritative command timeout.
  - MCP server (stdio) exposing `execute_lua`, `read_studio_state`, and
    `get_errors`; all logging on stderr so stdout stays clean for MCP framing.
  - Optional shared-token auth + loopback Host-header guard.
  - Plugin auto-install into the local Roblox Plugins folder on boot
    (`RBXMCP_AUTOINSTALL`).
  - `dev-enqueue` CLI + dev-only enqueue route for proving the pipeline without
    Studio.
- **Plugin (single-file `rbx-mcp.server.luau`):** polls the server, runs Lua via
  `loadstring`, captures output/return values/errors with tracebacks, reports
  back; minimal dock-widget UI (status, Start/Stop, Host/Port/Token).
- **Tests:** 52 server tests (config, logger, bridge, HTTP, install, MCP tools +
  result mapping, snippets) and a Studio command-bar harness for the plugin
  executor.

### Changed

- Plugin (v0.2.0): clearer status when HttpService is off ("HTTP service disabled
  - enable it in Experience settings → Security → Allow HTTP Requests"); connects
  automatically once it's enabled. Confirmed plugins **cannot** toggle HttpService
  themselves in current Studio, so enabling it stays a one-time manual step.

### Verified

- Studio spike: `loadstring` + `setfenv` capture + `xpcall` traceback all work in
  plugin context (2026-06-23).
- Built-binary smoke test: end-to-end enqueue → poll → result round-trip.

[Unreleased]: https://github.com/OWNER/rbx-mcp/commits/main
