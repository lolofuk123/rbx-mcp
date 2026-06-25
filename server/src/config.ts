import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read the package version from package.json so /health never reports a stale, hardcoded value. */
function readPkgVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    return (JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readPkgVersion();

export type LogLevel = "error" | "warn" | "info" | "debug";
const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

export interface Config {
  host: string;
  port: number;
  pollHoldMs: number;
  cmdTimeoutMs: number;
  cmdTimeoutMsMin: number;
  cmdTimeoutMsMax: number;
  maxResultBytes: number;
  maxQueueDepth: number;
  token: string | null;
  logLevel: LogLevel;
  dev: boolean;
  autoInstall: boolean;
  version: string;
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Read, validate, and clamp configuration from the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, version: string = VERSION): Config {
  const logRaw = (env.RBXMCP_LOG ?? "info").toLowerCase();
  const logLevel: LogLevel = LOG_LEVELS.includes(logRaw as LogLevel) ? (logRaw as LogLevel) : "info";
  const token = env.RBXMCP_TOKEN && env.RBXMCP_TOKEN.length > 0 ? env.RBXMCP_TOKEN : null;

  const cfg: Config = {
    host: env.RBXMCP_HOST && env.RBXMCP_HOST.length > 0 ? env.RBXMCP_HOST : "127.0.0.1",
    port: clampInt(env.RBXMCP_PORT, 30700, 0, 65535),
    pollHoldMs: clampInt(env.RBXMCP_POLL_HOLD_MS, 25000, 0, 60000),
    cmdTimeoutMs: clampInt(env.RBXMCP_CMD_TIMEOUT_MS, 30000, 1000, 600000),
    cmdTimeoutMsMin: 1000,
    cmdTimeoutMsMax: 600000,
    maxResultBytes: clampInt(env.RBXMCP_MAX_RESULT_BYTES, 1024 * 1024, 1024, 64 * 1024 * 1024),
    maxQueueDepth: clampInt(env.RBXMCP_MAX_QUEUE_DEPTH, 16, 1, 1024),
    token,
    logLevel,
    dev: env.RBXMCP_DEV === "1" || env.RBXMCP_DEV === "true",
    autoInstall: env.RBXMCP_AUTOINSTALL !== "off",
    version,
  };
  return cfg;
}
