# Roblox Studio AI Bridge — Project Concept

> **Working title:** RoMCP (Roblox Model Context Protocol bridge)
> **Status:** Concept / pre-spec
> **Purpose of this document:** Capture the vision, architecture, and scope so we can write detailed specs for each component.

---

## 1. One-line summary

A universal bridge that lets an AI agent (Claude) write Lua code and execute it directly inside Roblox Studio, receive the results, and iterate — enabling AI-driven building, scripting, and animation without task-specific tooling.

---

## 2. The problem

Roblox Studio has a rich internal API but no native way for an external AI agent to drive it. Today a developer must:

- Manually translate AI suggestions into Studio actions by hand.
- Copy/paste code back and forth with no feedback loop.
- Build separate, task-specific tools for each kind of automation (maps, animations, scripting, etc.).

There is no widely adopted, general-purpose solution that lets an AI agent *act* inside Studio and *see what happened*.

---

## 3. The core idea

Keep the plugin **dumb and universal**. It does exactly one thing:

```
Receive a Lua code string  →  Execute it inside Studio  →  Report back result / error
```

All intelligence lives on the AI side. Because the plugin just runs arbitrary Lua (via `loadstring()`), it never needs to be updated for new tasks — animations, map building, scripting, lighting, UI, Explorer organization, etc. are all just "different Lua."

---

## 4. Goals & non-goals

### Goals
- A minimal, universal Studio plugin that executes arbitrary Lua and returns results.
- A local bridge server that queues commands and relays responses.
- An MCP server so Claude can call Studio actions as native tools and iterate on errors.
- A clean feedback loop: **write → execute → read result → fix → repeat.**

### Non-goals (for v1)
- Publishing/uploading assets to the Roblox platform.
- A polished GUI beyond what's needed to enter an API key / status.
- Mocap-quality animation generation.
- Multi-user / cloud-hosted operation (local-first to start).

---

## 5. Architecture

```
Claude (via MCP)
      │
      ▼
┌─────────────────────────────────────────────┐
│  Bridge process (single process)             │
│  • MCP side: exposes tools to Claude         │
│    (execute_lua, read_state, get_errors)     │
│  • HTTP side: localhost endpoint the         │
│    plugin polls; queues commands, holds      │
│    results                                   │
└─────────────────────────────────────────────┘
      │
      ▼
Studio Plugin (Lua)  ──  polls bridge, runs loadstring(code), reports back
      │
      ▼
   Roblox Studio
```

**Why MCP over a fire-and-forget approach:** Claude gets *results back*, not just confirmation. That enables autonomous iteration — run code, read the error, fix it, retry — which is the feature that makes the whole thing genuinely useful instead of a glorified clipboard.

**Key decision — MCP server and bridge are ONE process.** The MCP server and the localhost bridge are deliberately merged into a single process: it exposes MCP tools to Claude on one side, and serves the localhost endpoint the plugin polls on the other. If they were separate processes, the user would have two things to launch. Merging them means a single launch command runs everything (see Section 8 — Setup & Developer Experience).

**Prior art — Rojo validates this pattern.** Rojo (the established Roblox file-sync tool) uses the same plugin-plus-local-server split: a Studio plugin that connects out to a local HTTP server (`rojo serve`). This proves the localhost-bridge approach is viable and accepted on the platform. The difference: Rojo does one-directional *file sync* (filesystem → Studio's DataModel), whereas ours does *bidirectional command execution with result feedback* for an AI agent. We borrow Rojo's transport architecture but repurpose it for live AI-driven execution. (Note: Rojo's core is a CLI installed via a toolchain manager; its VS Code extension is just a convenience wrapper — the real dependency is the CLI, not the editor.)

---

## 6. Components

### 6.1 Studio Plugin (Lua)
- Polls the local bridge server for pending commands.
- Executes received code via `loadstring()`.
- Captures success output, return values, and errors (with stack traces where possible).
- Sends results back to the bridge.
- Requires `HttpService` enabled; talks to `localhost`.
- Target size: small (~50–150 lines). Deliberately minimal.

### 6.2 Bridge process (MCP server + local HTTP bridge, single process)
This is one process serving two sides:

**MCP side (faces Claude):**
- Exposes MCP tools, e.g.:
  - `execute_lua(code)` — run code, return output/errors.
  - `read_studio_state(query)` — inspect workspace, Explorer, selection, properties.
  - `get_errors()` — fetch last execution errors.
- Registered in Claude Code / Claude app so Claude can call it directly.

**HTTP side (faces the plugin):**
- Runs a localhost HTTP server.
- Holds a command queue and a results store.
- Endpoints for: enqueue command (from MCP side), poll for next command (plugin), submit result (plugin), fetch result (MCP side).
- Handles request/response correlation (IDs) so multiple commands don't get crossed.

---

## 7. Roadmap

| Phase | Deliverable | Goal |
|-------|-------------|------|
| **1** | Studio Plugin (Lua) | Execute received Lua, report results |
| **2** | Bridge process (HTTP side) | Validate the full command → execute → result pipeline end to end |
| **3** | Bridge process (MCP side) | Expose the bridge as MCP tools Claude can call |
| **4** | Claude Integration | Register MCP, enable autonomous write → run → read → fix loops |

**Suggested first milestone:** Phases 1 + 2 together, to prove the pipeline works before adding the MCP layer.

---

## 8. Setup & Developer Experience

**Guiding principle:** Setup ease is the single biggest factor in adoption. A brilliant tool with a painful setup dies; a mediocre tool that's one command spreads. The whole real-world setup must collapse to: install the plugin once, paste one config block once, then it just works.

**The key insight that removes the "start the server" step:** because the bridge is launched through Claude's MCP config, **Claude itself starts the server.** The user never runs a manual `start` command — they paste one config block once, and the bridge boots whenever Claude does. (This is why the MCP server and bridge are merged into one process — see Section 5.)

So the entire setup, for either option below, is:
1. Install the plugin in Studio (once — drop the `.rbxm`/`.rbxmx` into the local Plugins folder; see Section 10 on why not the Creator Store)
2. Paste one config block into Claude (once)
3. Open Studio + Claude → it just works

### Option A — `npx` (Node-based, zero permanent install) — **IMPLEMENT FIRST**

The bridge is published as an npm package. No `npm install`, no `npm start`. The user pastes a config block and Claude launches it via `npx` on demand:

```json
{
  "mcpServers": {
    "romcp": {
      "command": "npx",
      "args": ["-y", "romcp"]
    }
  }
}
```

- **Pros:** Lightest possible; always latest version; fast for us to ship (`npm publish`); setup is "paste once, never touch again."
- **Cons:** Requires Node.js installed; first run slightly slower (downloads package).
- **Best for:** developers — the core early audience, who almost certainly already have Node.
- **Decision:** This is the v1 / MVP path. Build and validate this first.

### Option B — Single prebuilt binary (no runtime needed) — **CONSIDER LATER**

Compile the bridge into one standalone executable per platform (Windows `.exe`, macOS, Linux). User downloads it and points Claude at it. This is the **Rojo approach** (Rojo ships binaries so users need no toolchain).

```json
{
  "mcpServers": {
    "romcp": {
      "command": "C:\\Tools\\romcp.exe"
    }
  }
}
```

- **Pros:** Zero dependencies (no Node, no runtime); works for non-technical users; fastest startup.
- **Cons:** Much more work for us — cross-platform builds, code-signing so OSes don't flag it, hosting binaries, managing updates manually.
- **Best for:** the broader Roblox community who may not have/want Node.
- **Decision:** Worth considering after Option A proves the concept. v2 / wider-release polish.

| | Option A (`npx`) | Option B (binary) |
|---|---|---|
| User needs Node? | Yes | No |
| Effort for us | Low | High |
| Audience | Developers | Everyone |
| Updates | Automatic | We manage |
| Stage | **v1 / MVP (first)** | **v2 / later (consider)** |

---

## 9. Tech stack (proposed)

- **Plugin:** Lua (Roblox Studio plugin API, `HttpService`, `loadstring()`)
- **Bridge process:** Node.js / TypeScript — single process serving both the MCP side and the localhost HTTP side. (Node chosen to enable the `npx` Option A setup path.)
- **MCP:** MCP SDK (TypeScript)
- **Transport:** HTTP over localhost
- **Distribution (later):** single prebuilt binary per platform (Option B)

---

## 10. Distribution & monetization constraints

**Decision: we are NOT distributing on the Roblox Creator Store. We keep `loadstring()` and distribute off-platform.**

### Why not the Creator Store
The Creator Store auto-moderates assets on publish and restricts specific practices "to ensure asset safety," explicitly including custom Lua VMs, `getfenv`/`setfenv`, and remote-asset/dynamic-execution mechanisms — `loadstring()` and `require(assetId)` among them. The moderation targets the *capability* (an asset that can run arbitrary code not visible at publish time), not just the function name. Since our plugin's entire design is `loadstring()` executing arbitrary Lua fed from outside, it would almost certainly be auto-flagged and blocked — paid or free.

### Why we keep `loadstring()` anyway
We considered a reflection-based command protocol (fixed handlers: `CreateInstance`, `SetProperty`, `CallMethod`, etc.) that would sidestep the flagged capability and be Creator-Store-eligible. We also considered a custom `loadstring` / mini Lua VM — rejected, because a custom Lua VM is itself an explicitly flagged practice (and would read as evasion). 

We're choosing to **keep real `loadstring()`** because:
- It preserves the "dumb, universal, never-needs-updating" plugin that makes the project elegant.
- It supports in-Studio control flow and logic, not just one-shot API calls.
- Off-Store distribution is a perfectly normal, accepted workflow for dev tooling — and this project already requires an external bridge, so it was never going to be a one-click Store install anyway.

(The reflection command protocol remains a documented fallback if Creator Store presence ever becomes a priority — see Open Questions.)

### How we distribute instead
- **Plugin:** ship the `.rbxm`/`.rbxmx` via GitHub releases / our own site; user installs by dropping it into the local Plugins folder. The `loadstring` moderation applies to *Creator Store publishing*, not to plugins a user installs locally. (Same pattern many dev tools use.)
- **Bridge:** npm (`npx`, Option A) now; prebuilt binary (Option B) later.

### Monetization implications
- Creator Store's 100%-net-proceeds USD selling is **off the table** (we're not publishing there).
- Monetize **off-platform** instead — own site / Gumroad / Stripe. This also frees us from the Creator Store's one-time-payment-only limitation, so subscriptions or pay-as-you-scale models become possible.
- Viable shapes: free/open-source core with a paid Pro tier or hosted/managed version, paid polished installer, or donation/support model. (User brings their own Anthropic API key regardless, so we're selling the integration/convenience, not reselling AI.)

---

## 11. Key technical considerations & risks

- **Polling vs. push:** Studio plugins can't easily run a long-lived server, so polling the bridge is the likely model. Need to tune poll interval for responsiveness vs. overhead.
- **`loadstring()` security & distribution:** Powerful and arbitrary by design. Since it's local-only and developer-driven, the risk is contained — but it does make the plugin ineligible for the Creator Store, which is why we distribute off-platform (see Section 10). Should not be exposed to untrusted input.
- **Error capture fidelity:** Getting useful error messages and stack traces back out of `loadstring()` execution is what makes the iteration loop valuable. Worth investing in.
- **Command correlation:** Each command needs a unique ID so results map back correctly, especially if commands queue up.
- **HttpService limits:** Request size, rate, and the requirement that the user enable HttpService in Studio settings.
- **State reading:** Reading Studio state back into a clean, serializable form for Claude is a design problem of its own (how much detail, what format).

---

## 12. Why this is worth building

- **Novel:** No widely adopted open-source equivalent doing exactly this.
- **General-purpose:** One plugin, unlimited tasks — intelligence stays on the AI side.
- **Relevant:** MCP is new and central to current AI tooling.
- **Practical:** The Roblox dev community is large and could realistically adopt it.
- **Portfolio value:** Demonstrates systems thinking across Lua, server architecture, the MCP protocol, AI agent integration, and cross-ecosystem communication.

---

## 13. Open questions (to resolve during spec writing)

- Polling interval and command queueing semantics?
- What's the minimum viable set of MCP tools for v1?
- How rich should `read_studio_state` be at launch?
- Naming: RoMCP, StudioAgent, or something else?
- (Parked) Reflection command protocol as a Creator-Store-eligible variant — only if Store presence ever becomes a priority.

**Resolved so far:**
- ~~Node.js vs. Python~~ → **Node.js / TypeScript** (enables the `npx` setup path).
- ~~Separate MCP server vs. bridge~~ → **Merged into one process.**
- ~~How does setup stay easy~~ → **Option A (`npx`) first, Option B (binary) later;** Claude launches the bridge via MCP config so there's no manual start step.
- ~~Creator Store vs. off-platform~~ → **Off-platform.** `loadstring` is flagged by Store moderation; we keep `loadstring` and distribute off-Store (see Section 10).
- ~~loadstring vs. command protocol vs. custom VM~~ → **Keep real `loadstring`.** Command protocol parked as fallback; custom VM rejected (itself a flagged practice).

---

*This document is a living concept. Next step: turn each component in Section 6 into its own detailed spec.*
