import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../bridge.js";
import type { Config } from "../config.js";
import type { Logger } from "../log.js";
import { registerTools } from "./tools.js";

/** Build the MCP server (tools wired to the bridge). Transport is connected by the caller. */
export function createMcpServer(bridge: Bridge, config: Config, log: Logger): McpServer {
  const server = new McpServer({ name: "rbx-mcp", version: config.version });
  registerTools(server, bridge, config, log);
  return server;
}
