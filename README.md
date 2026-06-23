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

## Setup (target experience)

1. Add the MCP server to Claude's config:
   ```json
   {
     "mcpServers": {
       "rbx-mcp": { "command": "npx", "args": ["-y", "rbx-mcp"] }
     }
   }
   ```
2. Start/restart Roblox Studio. On first launch the server auto-installs the
   plugin into your local Plugins folder; Studio picks it up on restart.

That's it — open Studio + Claude and the loop works. See
[`server/README.md`](server/README.md) for env vars and manual install.

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
