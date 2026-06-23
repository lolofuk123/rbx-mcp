#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { createBridge } from "./bridge.js";
import { createHttpServer } from "./http.js";
import { createMcpServer } from "./mcp/server.js";
import { installPlugin } from "./install.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  log.info("starting rbx-mcp", {
    version: config.version,
    host: config.host,
    port: config.port,
    dev: config.dev,
    token: config.token ? "set" : "none",
  });

  const bridge = createBridge(config, log);
  const http = createHttpServer(bridge, config, log);
  await http.start();

  if (config.autoInstall) {
    const res = await installPlugin({ log });
    log.info("plugin auto-install", res);
  } else {
    log.info("plugin auto-install disabled (RBXMCP_AUTOINSTALL=off)");
  }

  const mcp = createMcpServer(bridge, config, log);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  log.info("MCP server connected over stdio");

  let shuttingDown = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { sig });
    bridge.shutdown("shutting down");
    await http.stop();
    try {
      await mcp.close();
    } catch {
      /* best-effort */
    }
    process.exit(0);
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => void shutdown(sig));
  }
}

main().catch((err) => {
  process.stderr.write(`[rbx-mcp] fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
