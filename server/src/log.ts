import type { LogLevel } from "./config.js";

const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Leveled logger that writes ONLY to stderr.
 *
 * stdout is reserved for MCP stdio framing — writing log text there would
 * corrupt the protocol stream. Every path here goes to process.stderr.
 */
export function createLogger(level: LogLevel): Logger {
  const threshold = RANK[level];

  function emit(l: LogLevel, msg: string, args: unknown[]): void {
    if (RANK[l] > threshold) return;
    const head = `[rbx-mcp] ${new Date().toISOString()} ${l.toUpperCase()} ${msg}`;
    const line = args.length > 0 ? `${head} ${args.map(fmt).join(" ")}` : head;
    process.stderr.write(`${line}\n`);
  }

  return {
    error: (m, ...a) => emit("error", m, a),
    warn: (m, ...a) => emit("warn", m, a),
    info: (m, ...a) => emit("info", m, a),
    debug: (m, ...a) => emit("debug", m, a),
  };
}
