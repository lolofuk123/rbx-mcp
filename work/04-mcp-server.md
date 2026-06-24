# Spec 04 — Bridge: MCP side

> Phase 3 (+ Phase 4 wiring). The MCP server face of the bridge process: tool
> definitions Claude calls, stdio transport, and how each tool drives the
> in-process [Bridge API (Spec 03)](03-bridge-http.md#4-in-process-api-consumed-by-spec-04).
> **Stack:** TypeScript + `@modelcontextprotocol/sdk`.

---

## 1. Responsibilities

- Speak MCP over **stdio** to Claude (the client that launched us via `npx`).
- Register and serve the v1 tool set.
- Translate tool calls → `bridge.enqueueAndAwait(...)` → structured tool results.
- Own the process bootstrap: start the HTTP bridge (Spec 03), wire shutdown.
- Keep stdout pristine for MCP framing; route all logs to stderr.

## 2. Process bootstrap & lifecycle (Phase 4 glue)

`bin/rbx-mcp` (the `npx rbx-mcp` entry):

```ts
async function main() {
  const bridge = createBridge(readConfig());     // Spec 03
  await bridge.start();                           // eager: /health live for setup debugging
  const server = createMcpServer(bridge);         // this spec
  const transport = new StdioServerTransport();
  await server.connect(transport);                // begins serving MCP on stdio
  // shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => shutdown(server, bridge));
}
```

- **Claude starts us, not the user** (concept §8): the MCP config block runs
  `npx -y rbx-mcp`; Claude spawns the process, which boots both faces. No manual
  `start`.
- **On boot, the server also auto-installs the plugin** into the local Roblox
  Plugins folder (see §5.2) — so the user never places a file by hand.
- **stdout discipline:** `StdioServerTransport` uses stdout for protocol. Any
  stray `console.log` corrupts the stream → **all logging via stderr** (Spec 03 §9).
  Lint/guard against accidental stdout writes.
- Clean shutdown rejects pending commands (Spec 03 §8) and closes the HTTP server.

## 3. Tool set (v1)

`execute_lua` is the primitive; the other two are thin sugar over it so we keep
the "one universal primitive" design while giving Claude ergonomic entry points.

### 3.1 `execute_lua` — the primitive

**Description (to Claude):** Run a Lua/Luau code string inside Roblox Studio and
return its captured output, return values, and any error with traceback. Use
this to build, script, inspect, or modify anything in Studio; iterate by reading
the error and re-running.

**Input schema**

```jsonc
{
  "code":      { "type": "string", "description": "Luau to execute in Studio (runs via loadstring)." },
  "timeoutMs": { "type": "number", "description": "Optional execution budget; default 30000.", "minimum": 1000 },
  "label":     { "type": "string", "description": "Optional short human label for logs/UI." }
}
```
`code` required.

**Behavior**
1. If `bridge.getStatus().pluginConnected === false`, return a friendly error
   result telling Claude the Studio plugin isn't connected (so it stops retrying
   blindly). (`OPEN`: still enqueue and let it time out vs. fail fast — proposed:
   **fail fast** with guidance.)
2. `const r = await bridge.enqueueAndAwait({ code, timeoutMs, meta:{label} })`.
3. Map `Result` → MCP tool result (§4).

### 3.2 `read_studio_state` — curated inspection

Sugar that runs a **predefined, server-owned Lua snippet** (not arbitrary code)
to return Studio state in a clean, serializable form. Keeps Claude from
re-writing introspection Lua every time and gives stable output shape.

**Input schema**

```jsonc
{
  "query": {
    "type": "string",
    "enum": ["selection", "explorer_tree", "instance", "services_summary"],
    "description": "What to inspect."
  },
  "path":  { "type": "string", "description": "For query=instance: full name path, e.g. 'Workspace.Model.Part'." },
  "depth": { "type": "number", "description": "For explorer_tree: max depth (default 2)." }
}
```

**Behavior:** select a templated Lua snippet by `query`, interpolate validated
params, run it through the same `bridge.enqueueAndAwait`, and return its
serialized output. The snippets live in the bridge repo (versioned, reviewed),
e.g.:
- `selection` → `game:GetService("Selection"):Get()` mapped to full names + classes.
- `explorer_tree` → bounded recursive walk of key services to `depth`.
- `instance` → resolve `path`, dump className + a safe subset of properties.
- `services_summary` → counts/among workspace, Lighting, ReplicatedStorage, etc.

This means `read_studio_state` needs **no new plugin capability** — it's just
`execute_lua` with code we wrote. (Concept §13 "how rich should read_studio_state
be" → start with these four; expand later.)

### 3.3 `get_errors` — recent failures

Returns the last N error results from the bridge ring buffer
([Spec 03 §3](03-bridge-http.md#3-internal-model)).

**Input schema:** `{ "limit": { "type": "number", "default": 5 } }`

**Note / `OPEN`:** somewhat redundant since `execute_lua` already returns errors
inline. Kept for v1 because it lets Claude recover error context after a
compaction or a multi-step sequence without re-running. If it proves unused,
drop it (concept §13: "minimum viable set of MCP tools").

## 4. Result mapping (Result → MCP tool result)

Goal: give Claude a response it can *act on* — clearly success or failure, with
the error and traceback front-and-center for the fix loop.

```ts
function toToolResult(r: Result) {
  if (r.ok) {
    return {
      content: [{ type: "text", text:
        [ "✅ ok",
          r.output && `output:\n${r.output}`,
          r.returnValues?.length && `returns: ${r.returnValues.join(", ")}`,
          `(${r.durationMs} ms${r.truncated ? ", truncated" : ""})`,
        ].filter(Boolean).join("\n") }],
      isError: false,
    };
  }
  return {
    content: [{ type: "text", text:
      [ `❌ ${r.error!.phase} error: ${r.error!.message}`,
        r.output && `output before error:\n${r.output}`,
        `traceback:\n${r.error!.traceback}`,
      ].filter(Boolean).join("\n") }],
    isError: true,    // signals failure so Claude treats it as a fixable error
  };
}
```

- Use `isError: true` on failures so the client/Claude reliably distinguishes a
  failed execution from a successful one that happened to print "error".
- Keep the error path information-dense: phase + message + traceback + any output
  produced before the failure. This is the iteration loop's fuel.

## 5. Setup: config block + plugin auto-install (Phase 4)

The user-facing setup is **one config block** plus an automatic plugin install.

### 5.1 The config block (concept §8 Option A)

```json
{
  "mcpServers": {
    "rbx-mcp": { "command": "npx", "args": ["-y", "rbx-mcp"] }
  }
}
```

With optional env (token/port) when not using defaults:

```json
{
  "mcpServers": {
    "rbx-mcp": {
      "command": "npx",
      "args": ["-y", "rbx-mcp"],
      "env": { "RBXMCP_PORT": "30700", "RBXMCP_TOKEN": "shared-secret" }
    }
  }
}
```

The same `RBXMCP_PORT`/`RBXMCP_TOKEN` must be entered in the plugin UI (Spec 02 §9)
when overriding defaults.

### 5.2 Plugin auto-install (the near-one-command win)

The user never hunts down a plugin file. On startup the server **installs the
bundled plugin into the local Roblox Plugins folder**:

- The npm package bundles `rbx-mcp.server.luau` (the single-file plugin, Spec 02 §2).
- On boot the server resolves the OS-specific Plugins path:
  - Windows: `%LOCALAPPDATA%/Roblox/Plugins`
  - macOS: `~/Documents/Roblox/Plugins`
  - Linux/other: skip with a logged note (no standard Studio path).
- It writes/refreshes `rbx-mcp.server.luau` there when missing or older than the
  bundled version (compare an embedded version stamp). It will **not** clobber a
  locally-modified copy at the same version (checksum differs ⇒ log + skip).
- Controlled by `RBXMCP_AUTOINSTALL` (default `on`; set `off` for users who
  manage the plugin themselves).

This collapses setup to: **paste the config block once → restart Studio.**

### 5.3 The irreducible step

Studio only scans the Plugins folder at startup, so the user must **start/restart
Studio once** after the first server launch for the freshly-installed plugin to
load. There's no way around this short of a Creator-Store install (ruled out —
concept §10). After that first load the plugin persists across sessions.

### 5.4 RESOLVED — HttpService cannot be auto-enabled by the plugin

✅ Tested 2026-06-24: a plugin **cannot** set `HttpService.HttpEnabled`. It works
from the Command Bar (which runs at a higher security identity), but not from
plugin security context. So enabling HttpService stays a **one-time manual step**.
The plugin detects the off state on Start, shows a clear status ("HTTP service
disabled - enable it in Experience settings → Security → Allow HTTP Requests"), and
connects automatically once the user enables it.

## 6. Errors surfaced to Claude

- **Plugin not connected** → `execute_lua` returns `isError:true` with guidance to
  open Studio and enable the RoMCP plugin (don't just hang).
- **Command timeout** → mapped from the synthetic timeout `Result`
  (Spec 03 §7): `isError:true`, `phase:"timeout"`, suggesting the code may have an
  infinite loop or Studio is busy.
- **Bridge busy / queue full** (if `maxQueueDepth` adopted) → `isError:true`,
  "bridge busy, retry".
- All other internal faults → `phase:"internal"`, logged to stderr with detail,
  summarized to Claude.

## 7. Tests (Phase 3 acceptance)

With the HTTP bridge faked/stubbed (or a real Spec 03 bridge + a scripted plugin
stub):

1. **Tool listing:** server advertises `execute_lua`, `read_studio_state`,
   `get_errors` with correct schemas.
2. **execute_lua success:** call → enqueue → stubbed ok result → MCP result has
   `isError:false`, includes output + returns.
3. **execute_lua failure:** stubbed error result → `isError:true`, includes
   message + traceback + phase.
4. **Plugin disconnected:** `getStatus().pluginConnected=false` → fail-fast
   guidance, no hang.
5. **read_studio_state:** `query:"selection"` runs the templated snippet (assert
   the generated Lua), returns serialized state; bad `path` for `instance` →
   clear error.
6. **get_errors:** after N failing executes, returns the last `limit` errors.
7. **stdout cleanliness:** assert nothing but MCP framing is ever written to
   stdout during a session.
8. **Shutdown:** SIGINT rejects pending tool calls and closes the bridge.

## 8. OPEN items

- `OPEN` Final tool surface: keep/drop `get_errors`; whether to add a
  `cancel`/`interrupt` tool given Luau's weak interruption story.
- `OPEN` Streaming partial output for long-running code (MCP progress
  notifications) — deferred; v1 is request/response.
- `OPEN` `read_studio_state` output format: plain text vs. structured JSON in the
  tool result. Proposed: human-readable text for v1 (Claude parses it fine);
  revisit structured if tooling needs it.
