import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../bridge.js";
import type { Config } from "../config.js";
import type { Logger } from "../log.js";
import { toToolResult, textResult, type ToolResult } from "./toToolResult.js";
import { buildStateSnippet, isSafePath, type StateQuery } from "./snippets.js";

const NOT_CONNECTED =
  "The Roblox Studio plugin isn't connected. Open Studio, make sure the rbx-mcp " +
  "plugin is enabled and Started, and that HttpService is allowed (Game Settings → Security).";

export function registerTools(server: McpServer, bridge: Bridge, config: Config, log: Logger): void {
  server.registerTool(
    "execute_lua",
    {
      title: "Execute Lua in Roblox Studio",
      description:
        "Run a Luau code string inside Roblox Studio (via loadstring) and return its captured " +
        "output, return values, and any error with traceback. Use this to build, script, inspect, " +
        "or modify anything in Studio; iterate by reading the error and re-running.",
      inputSchema: {
        code: z.string().describe("Luau code to execute in Studio."),
        timeoutMs: z.number().int().min(1000).max(600000).optional().describe("Execution budget in ms (default 30000)."),
        label: z.string().optional().describe("Short human label for logs/UI."),
      },
    },
    async ({ code, timeoutMs, label }): Promise<ToolResult> => {
      if (!bridge.getStatus().pluginConnected) return textResult(NOT_CONNECTED, true);
      try {
        const r = await bridge.enqueueAndAwait({ code, timeoutMs, meta: { label } });
        return toToolResult(r);
      } catch (err) {
        return textResult(`❌ ${(err as Error).message}`, true);
      }
    },
  );

  server.registerTool(
    "read_studio_state",
    {
      title: "Read Roblox Studio state",
      description:
        "Inspect Studio state in a clean form: 'selection' (current selection), 'explorer_tree' " +
        "(workspace tree to a depth), 'instance' (one instance by dotted path, e.g. 'Workspace.Model.Part'), " +
        "or 'services_summary'. Runs a server-owned snippet — no arbitrary code.",
      inputSchema: {
        query: z.enum(["selection", "explorer_tree", "instance", "services_summary"]),
        path: z.string().optional().describe("For query=instance: dotted path like 'Workspace.Model.Part'."),
        depth: z.number().int().min(1).max(6).optional().describe("For query=explorer_tree: max depth (default 2)."),
      },
    },
    async ({ query, path, depth }): Promise<ToolResult> => {
      if (query === "instance" && !isSafePath(path)) {
        return textResult("`path` is required for query=instance and must look like 'Workspace.Model.Part'.", true);
      }
      if (!bridge.getStatus().pluginConnected) return textResult(NOT_CONNECTED, true);
      const code = buildStateSnippet(query as StateQuery, { path, depth });
      try {
        const r = await bridge.enqueueAndAwait({ code, meta: { label: `read_studio_state:${query}` } });
        return toToolResult(r);
      } catch (err) {
        return textResult(`❌ ${(err as Error).message}`, true);
      }
    },
  );

  server.registerTool(
    "get_errors",
    {
      title: "Recent execution errors",
      description: "Return the most recent failed executions (message + traceback). Useful for recovering context.",
      inputSchema: {
        limit: z.number().int().min(1).max(20).optional().describe("How many recent errors (default 5)."),
      },
    },
    async ({ limit }): Promise<ToolResult> => {
      const errs = bridge.getRecentErrors(limit ?? 5);
      if (errs.length === 0) return textResult("No recent errors.");
      const text = errs
        .map((e, i) => `#${i + 1} [${e.error?.phase ?? "?"}] ${e.error?.message ?? ""}\n${e.error?.traceback ?? ""}`.trimEnd())
        .join("\n\n");
      return textResult(text);
    },
  );

  log.debug("registered tools", { tools: ["execute_lua", "read_studio_state", "get_errors"] });
}
