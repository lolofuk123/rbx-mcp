import type { Result } from "../types.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  // The MCP SDK's CallToolResult carries an open index signature; mirror it so
  // our handlers are assignable to registerTool's expected return type.
  [key: string]: unknown;
}

/**
 * Map an execution Result into an MCP tool result.
 *
 * Failures set `isError: true` and lead with phase + message + traceback so
 * Claude can read the error and fix it — that feedback is the whole point.
 */
export function toToolResult(r: Result): ToolResult {
  if (r.ok) {
    const lines = ["✅ ok"];
    if (r.output) lines.push(`output:\n${r.output}`);
    if (r.returnValues && r.returnValues.length > 0) lines.push(`returns: ${r.returnValues.join(", ")}`);
    lines.push(`(${r.durationMs} ms${r.truncated ? ", truncated" : ""})`);
    return { content: [{ type: "text", text: lines.join("\n") }], isError: false };
  }
  const e = r.error;
  const lines = [`❌ ${e?.phase ?? "internal"} error: ${e?.message ?? "unknown error"}`];
  if (r.output) lines.push(`output before error:\n${r.output}`);
  if (e?.traceback) lines.push(`traceback:\n${e.traceback}`);
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}

export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError };
}
